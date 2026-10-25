import type { SQLiteDatabase } from 'expo-sqlite';
import { randomUUID } from 'expo-crypto';
import { monthKey } from '@finzen/core';
import { getDb } from './db';

/**
 * Capa de acceso a datos (primitivas). Toda escritura de una tabla sincronizable pasa por
 * `writeRow`, que además deja el cambio en `sync_queue` (paso de sincronización: se sube a
 * Supabase al haber conexión). Las operaciones compuestas llaman a `writeRow` dentro de UNA
 * transacción (`db.withTransactionAsync`) para que sean atómicas.
 */

export type Row = Record<string, string | number | null>;
export type Db = SQLiteDatabase;

export const uid = () => randomUUID();

/** Inserta o reemplaza una fila completa y la encola para sync. NO abre transacción. */
export async function writeRow(db: Db, table: string, row: Row): Promise<void> {
  const cols = Object.keys(row); // claves internas, nunca entrada del usuario
  await db.runAsync(
    `INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
    cols.map((c) => row[c] as string | number | null),
  );
  await db.runAsync(
    'INSERT INTO sync_queue (table_name,row_id,op,payload,created_at) VALUES (?,?,?,?,?)',
    [table, String(row.id), 'upsert', JSON.stringify(row), Date.now()],
  );
}

/** Lee la fila, aplica los cambios, sube updated_at y la reescribe. */
export async function patchRow(db: Db, table: string, id: string, patch: Partial<Row>): Promise<void> {
  const current = await db.getFirstAsync<Row>(`SELECT * FROM ${table} WHERE id=?`, [id]);
  if (!current) throw new Error(`No existe ${table}/${id}`);
  await writeRow(db, table, { ...current, ...patch, updated_at: Date.now() });
}

/** Borrado lógico (así el borrado también se sincroniza). */
export const softDelete = (db: Db, table: string, id: string) =>
  patchRow(db, table, id, { deleted_at: Date.now() });

// ───────────── Ajustes ─────────────
export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  return (await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key=?', [key]))?.value ?? null;
}

export async function setSetting(key: string, value: string, scope: 'user' | 'device' = 'user'): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO settings (key,value,scope,updated_at) VALUES (?,?,?,?)',
    [key, value, scope, Date.now()],
  );
}

// ───────────── Cuentas (activos) ─────────────
export type AccountKind = 'savings' | 'checking' | 'cash' | 'wallet' | 'investment';
export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  savings: 'Ahorros', checking: 'Corriente', cash: 'Efectivo', wallet: 'Billetera digital', investment: 'Inversión',
};

export interface AccountInput { name: string; kind: AccountKind; balance: number; currency: string }
export interface Account extends AccountInput { id: string }

export async function addAccount(a: AccountInput): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.withTransactionAsync(() =>
    writeRow(db, 'accounts', {
      id: uid(), name: a.name, kind: a.kind, balance: a.balance, currency: a.currency,
      last4: null, archived: 0, created_at: now, updated_at: now, deleted_at: null,
    }),
  );
}

export async function listAccounts(): Promise<Account[]> {
  const db = await getDb();
  return db.getAllAsync<Account>(
    'SELECT id,name,kind,balance,currency FROM accounts WHERE deleted_at IS NULL AND archived=0 ORDER BY created_at',
  );
}

/** Suma `delta` (puede ser negativo) al saldo de una cuenta. Dentro de una transacción abierta. */
export async function adjustAccount(db: Db, accountId: string, delta: number): Promise<void> {
  const acc = await db.getFirstAsync<{ balance: number }>('SELECT balance FROM accounts WHERE id=?', [accountId]);
  if (!acc) return;
  await patchRow(db, 'accounts', accountId, { balance: acc.balance + delta });
}

// ───────────── Patrimonio ─────────────
export interface NetWorth { assets: number; liabilities: number; net: number }

export async function getNetWorth(): Promise<NetWorth> {
  const db = await getDb();
  const a = await db.getFirstAsync<{ s: number | null }>(
    'SELECT SUM(balance) AS s FROM accounts WHERE deleted_at IS NULL AND archived=0',
  );
  const l = await db.getFirstAsync<{ s: number | null }>(
    "SELECT SUM(balance) AS s FROM debts WHERE deleted_at IS NULL AND status='active'",
  );
  const assets = a?.s ?? 0;
  const liabilities = l?.s ?? 0;
  return { assets, liabilities, net: assets - liabilities };
}

/** Guarda/actualiza la foto del patrimonio del mes actual (alimenta la gráfica de evolución). */
export async function recordSnapshot(): Promise<NetWorth> {
  const nw = await getNetWorth();
  const db = await getDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO net_worth_snapshots (month,assets,liabilities,net,updated_at) VALUES (?,?,?,?,?)',
    [monthKey(), nw.assets, nw.liabilities, nw.net, Date.now()],
  );
  return nw;
}

export interface Snapshot { month: string; net: number }

export async function listSnapshots(limit = 6): Promise<Snapshot[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Snapshot>(
    'SELECT month, net FROM net_worth_snapshots ORDER BY month DESC LIMIT ?', [limit],
  );
  return rows.reverse();
}
// ───────────── NUEVAS FUNCIONES PARA FASE 1 ─────────────

/**
 * Busca la primera cuenta activa del usuario. Si no tiene ninguna, crea automáticamente
 * una cuenta "Efectivo / General" para que los movimientos no queden huérfanos.
 */
export async function getOrCreateDefaultAccount(db: Db): Promise<string> {
  // 1. Intentamos buscar cualquier cuenta que ya exista
  const existing = await db.getFirstAsync<{ id: string }>('SELECT id FROM accounts WHERE deleted_at IS NULL AND archived=0 LIMIT 1');
  if (existing) return existing.id;

  // 2. Si no hay ninguna, creamos la cuenta por defecto
  const newId = uid();
  const now = Date.now();
  await writeRow(db, 'accounts', {
    id: newId, 
    name: 'Efectivo / General', 
    kind: 'cash', 
    balance: 0, 
    currency: 'COP',
    last4: null, 
    archived: 0, 
    created_at: now, 
    updated_at: now, 
    deleted_at: null,
  });
  return newId;
}

/**
 * Ajusta el saldo de una cuenta a un valor exacto y deja un registro en el historial.
 * Sirve para cuando olvidaste registrar un ingreso/gasto y necesitas cuadrar las cuentas.
 */
export async function reconcileAccountBalance(db: Db, accountId: string, newBalance: number): Promise<void> {
  // 1. Leemos el saldo actual antes de cambiarlo
  const acc = await db.getFirstAsync<{ balance: number }>('SELECT balance FROM accounts WHERE id=?', [accountId]);
  if (!acc) return;
  
  // 2. Calculamos la diferencia (puede ser positiva o negativa)
  const delta = newBalance - acc.balance;
  if (delta === 0) return; // Si no hay diferencia, no hacemos nada

  // 3. Actualizamos el saldo real en la tabla de cuentas
  await patchRow(db, 'accounts', accountId, { balance: newBalance });

  // 4. Creamos una transacción "fantasma" para que el historial refleje el ajuste
  const now = Date.now();
  await writeRow(db, 'transactions', {
    id: uid(),
    account_id: accountId,
    // Usamos 'cat_ingreso_otros' si el saldo subió (delta > 0) o 'cat_otros' si bajó
    category_id: delta > 0 ? 'cat_ingreso_otros' : 'cat_otros',
    debt_id: null,
    type: delta > 0 ? 'income' : 'expense',
    amount: Math.abs(delta),
    merchant: 'Ajuste de saldo',
    note: `Ajuste manual: saldo anterior ${acc.balance}, saldo nuevo ${newBalance}`,
    occurred_at: now,
    source: 'manual',
    payment_method: 'cash',
    status: 'posted',
    dedupe_hash: null,
    created_at: now, 
    updated_at: now, 
    deleted_at: null,
  });
}
