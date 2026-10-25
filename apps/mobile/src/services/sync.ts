import 'react-native-url-polyfill/auto';
import * as SecureStore from 'expo-secure-store';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SYNCED_TABLES } from '@finzen/db';
import { getDb } from './db';
import { getSetting, setSetting } from './repo';

/**
 * Sincronización OPCIONAL con tu propio proyecto de Supabase (plan gratuito).
 *  - La app funciona 100 % sin esto. Es un respaldo en la nube y para usar varios celulares.
 *  - Cada persona crea su proyecto y pega su URL + anon key en la app (nada va en el repo).
 *  - La contraseña NO se guarda: solo el refresh token, en SecureStore (Keystore de Android).
 *  - Resolución de conflictos: última escritura gana (updated_at); lo aplica un trigger en la nube.
 *  - Solo se envían las tablas de SYNCED_TABLES; la bitácora de notificaciones nunca sale del celular.
 */
const K = { url: 'finzen_sb_url', anon: 'finzen_sb_anon', refresh: 'finzen_sb_refresh', email: 'finzen_sb_email' };

// Padres antes que hijos
const ORDER = ['categories', 'accounts', 'debts', 'debt_installments', 'transactions', 'budgets', 'categorization_rules'] as const;
const SYNCED_SETTINGS = ['palette', 'mode'];

export interface SyncConfig { url: string; anon: string; email: string | null }

export async function getSyncConfig(): Promise<SyncConfig | null> {
  const url = await SecureStore.getItemAsync(K.url);
  const anon = await SecureStore.getItemAsync(K.anon);
  if (!url || !anon) return null;
  return { url, anon, email: await SecureStore.getItemAsync(K.email) };
}

export async function saveSyncConfig(url: string, anon: string): Promise<void> {
  const clean = url.trim().replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(clean)) {
    throw new Error('La URL debe verse así: https://xxxxxxxx.supabase.co');
  }
  await SecureStore.setItemAsync(K.url, clean);
  await SecureStore.setItemAsync(K.anon, anon.trim());
}

export async function clearSyncCredentials(): Promise<void> {
  for (const k of Object.values(K)) await SecureStore.deleteItemAsync(k);
}

function makeClient(cfg: SyncConfig): SupabaseClient {
  return createClient(cfg.url, cfg.anon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

async function remember(email: string, refresh: string | undefined) {
  await SecureStore.setItemAsync(K.email, email);
  if (refresh) await SecureStore.setItemAsync(K.refresh, refresh);
}

export async function signUp(email: string, password: string): Promise<string> {
  const cfg = await getSyncConfig();
  if (!cfg) throw new Error('Primero guarda la URL y la anon key.');
  const { data, error } = await makeClient(cfg).auth.signUp({ email: email.trim(), password });
  if (error) throw new Error(error.message);
  if (!data.session) return 'Cuenta creada. Confirma el correo que te llegó y luego inicia sesión.';
  await remember(email.trim(), data.session.refresh_token);
  return 'Cuenta creada y sesión iniciada.';
}

export async function signIn(email: string, password: string): Promise<void> {
  const cfg = await getSyncConfig();
  if (!cfg) throw new Error('Primero guarda la URL y la anon key.');
  const { data, error } = await makeClient(cfg).auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(error.message);
  await remember(email.trim(), data.session?.refresh_token);
}

export async function signOut(): Promise<void> {
  await SecureStore.deleteItemAsync(K.refresh);
}

export async function isSignedIn(): Promise<boolean> {
  return (await getSyncConfig()) !== null && (await SecureStore.getItemAsync(K.refresh)) !== null;
}

async function openSession(): Promise<{ sb: SupabaseClient; userId: string }> {
  const cfg = await getSyncConfig();
  const refresh = await SecureStore.getItemAsync(K.refresh);
  if (!cfg || !refresh) throw new Error('No hay sesión de sincronización. Inicia sesión primero.');
  const sb = makeClient(cfg);
  const { data, error } = await sb.auth.refreshSession({ refresh_token: refresh });
  if (error || !data.session) throw new Error('La sesión expiró. Inicia sesión de nuevo.');
  await SecureStore.setItemAsync(K.refresh, data.session.refresh_token); // los refresh token rotan
  return { sb, userId: data.session.user.id };
}

export async function pendingCount(): Promise<number> {
  const db = await getDb();
  return (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM sync_queue'))?.n ?? 0;
}

export async function lastSyncAt(): Promise<number | null> {
  const v = await getSetting('sync_last_at');
  return v ? Number(v) : null;
}

/** La primera vez, encola TODO lo que ya existe para subirlo. */
async function enqueueExisting(): Promise<void> {
  if ((await getSetting('sync_initialized')) === '1') return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const now = Date.now();
    for (const t of SYNCED_TABLES) {
      const rows = await db.getAllAsync<{ id: string }>(`SELECT * FROM ${t}`);
      for (const r of rows) {
        await db.runAsync(
          'INSERT INTO sync_queue (table_name,row_id,op,payload,created_at) VALUES (?,?,?,?,?)',
          [t, r.id, 'upsert', JSON.stringify(r), now],
        );
      }
    }
  });
  await setSetting('sync_initialized', '1', 'device');
}

async function push(sb: SupabaseClient): Promise<number> {
  const db = await getDb();
  const queued = await db.getAllAsync<{ id: number; table_name: string; payload: string | null }>(
    'SELECT id, table_name, payload FROM sync_queue ORDER BY id LIMIT 3000',
  );
  if (queued.length === 0) return 0;

  // Solo importa la versión más reciente de cada fila
  const latest = new Map<string, { table: string; row: Record<string, unknown> }>();
  for (const q of queued) {
    if (!q.payload || !(ORDER as readonly string[]).includes(q.table_name)) continue;
    const row = JSON.parse(q.payload) as Record<string, unknown>;
    latest.set(`${q.table_name}/${row.id}`, { table: q.table_name, row });
  }
  for (const table of ORDER) {
    const rows = [...latest.values()].filter((v) => v.table === table).map((v) => v.row);
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await sb.from(table).upsert(rows.slice(i, i + 200), { onConflict: 'id' });
      if (error) throw new Error(`${table}: ${error.message}`);
    }
  }
  await db.runAsync('DELETE FROM sync_queue WHERE id <= ?', [queued[queued.length - 1]!.id]);
  return latest.size;
}

async function pull(sb: SupabaseClient): Promise<number> {
  const db = await getDb();
  let pulled = 0;
  for (const table of ORDER) {
    const cols = new Set((await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`)).map((c) => c.name));
    let cursor = Number((await getSetting(`sync_cursor_${table}`)) ?? 0);
    for (;;) {
      const { data, error } = await sb.from(table).select('*').gt('updated_at', cursor).order('updated_at', { ascending: true }).limit(500);
      if (error) throw new Error(`${table}: ${error.message}`);
      if (!data || data.length === 0) break;
      await db.withTransactionAsync(async () => {
        await db.execAsync('PRAGMA defer_foreign_keys = ON'); // padre e hijo pueden llegar en cualquier orden
        for (const remote of data as Record<string, any>[]) {
          const local = await db.getFirstAsync<{ updated_at: number }>(`SELECT updated_at FROM ${table} WHERE id=?`, [remote.id]);
          if (local && local.updated_at >= remote.updated_at) continue; // gana la escritura más reciente
          const keys = Object.keys(remote).filter((k) => cols.has(k));
          await db.runAsync(
            `INSERT OR REPLACE INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
            keys.map((k) => remote[k] as string | number | null),
          );
          pulled++;
        }
      });
      cursor = Number((data[data.length - 1] as Record<string, any>).updated_at);
      await setSetting(`sync_cursor_${table}`, String(cursor), 'device');
      if (data.length < 500) break;
    }
  }
  return pulled;
}

/** Paleta y modo se comparten entre tus dispositivos. */
async function syncSettings(sb: SupabaseClient, userId: string): Promise<void> {
  const db = await getDb();
  const { data } = await sb.from('app_settings').select('key,value,updated_at');
  const remote = new Map((data ?? []).map((r: any) => [r.key as string, r as { value: string; updated_at: number }]));
  for (const key of SYNCED_SETTINGS) {
    const local = await db.getFirstAsync<{ value: string; updated_at: number }>('SELECT value,updated_at FROM settings WHERE key=?', [key]);
    const r = remote.get(key);
    if (local && (!r || local.updated_at > r.updated_at)) {
      await sb.from('app_settings').upsert({ user_id: userId, key, value: local.value, updated_at: local.updated_at }, { onConflict: 'user_id,key' });
    } else if (r && (!local || r.updated_at > local.updated_at)) {
      await db.runAsync('INSERT OR REPLACE INTO settings (key,value,scope,updated_at) VALUES (?,?,?,?)', [key, r.value, 'user', r.updated_at]);
    }
  }
}

let running: Promise<{ pushed: number; pulled: number }> | null = null;

/** Sube los cambios locales y baja los remotos. Seguro de llamar varias veces seguidas. */
export function syncNow(): Promise<{ pushed: number; pulled: number }> {
  running ??= (async () => {
    try {
      const { sb, userId } = await openSession();
      await enqueueExisting();
      const pushed = await push(sb);
      const pulled = await pull(sb);
      await syncSettings(sb, userId);
      await setSetting('sync_last_at', String(Date.now()), 'device');
      await setSetting('sync_last_error', '', 'device');
      return { pushed, pulled };
    } catch (e) {
      await setSetting('sync_last_error', e instanceof Error ? e.message : String(e), 'device');
      throw e;
    } finally {
      running = null;
    }
  })();
  return running;
}

let lastAuto = 0;
/** Sincronización silenciosa (como máximo cada 2 minutos) si hay sesión. Nunca lanza error. */
export async function autoSync(): Promise<void> {
  if (Date.now() - lastAuto < 120_000) return;
  lastAuto = Date.now();
  try { if (await isSignedIn()) await syncNow(); } catch { /* sin internet o sesión caducada: se reintenta luego */ }
}

/** Borra tus datos de la nube (no borra tu usuario: eso se hace en el panel de Supabase). */
export async function deleteRemoteData(): Promise<void> {
  const { sb } = await openSession();
  const { error } = await sb.rpc('delete_my_data');
  if (error) throw new Error(error.message);
}
