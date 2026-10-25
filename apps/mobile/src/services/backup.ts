import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as Notifications from 'expo-notifications';
import * as Sharing from 'expo-sharing';
import {
  assertBackupSize, csvCell, decryptBackup, encryptBackup, filterRestoredSettings, guessColumns, isEncryptedBackup,
  isPlainRow, mapRows, parseCsv, type ColumnMap,
} from '@finzen/core';
import { seedCategoriesSql } from '@finzen/db';
import { NotificationListener } from '../../modules/finzen-notifications';
import { clearGeminiKey } from './ai';
import { getDb } from './db';
import { clearPin } from './security';
import { clearSyncCredentials } from './sync';
import { suggestCategory } from './transactions';
import { uid } from './repo';

/**
 * Exportar / importar / restaurar / borrar. Todo local: el usuario es dueño de sus datos.
 * Reglas de seguridad de este archivo:
 *  - El respaldo JSON SIEMPRE sale cifrado (AES-256-GCM con contraseña). El CSV es para Excel y sale en claro:
 *    la pantalla lo avisa.
 *  - Los archivos temporales (exportaciones, extractos elegidos, fotos de recibos) se borran apenas se usan.
 *  - Un respaldo a restaurar no es de confianza: se valida tamaño, forma de las filas y se filtran los ajustes.
 */
const USER_TABLES = [
  // Orden de inserción (padres antes que hijos)
  'categories', 'accounts', 'debts', 'debt_installments', 'transactions', 'budgets', 'categorization_rules',
] as const;
const BACKUP_VERSION = 1;
const MAX_IMPORT_BYTES = 5_000_000; // extractos CSV
const MAX_CSV_ROWS = 50_000;

// ───────────── Archivos temporales ─────────────
export function deleteQuietly(uri: string | undefined | null): void {
  if (!uri) return;
  try { const f = new File(uri); if (f.exists) f.delete(); } catch { /* ya no existe */ }
}

/** Borra restos de exportaciones, selector de archivos y cámara. Se llama al abrir la app. */
export function cleanTempFiles(): void {
  try {
    for (const entry of new Directory(Paths.cache).list()) {
      const name = entry.name ?? '';
      if (/^finzen-/.test(name) || name === 'DocumentPicker' || name === 'ImagePicker' || name === 'Camera') {
        try { entry.delete(); } catch { /* en uso */ }
      }
    }
  } catch { /* sin acceso al caché: nada que limpiar */ }
}

async function shareText(filename: string, content: string, mime: string) {
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(content);
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: mime, dialogTitle: filename });
  else throw new Error('Este dispositivo no permite compartir archivos.');
  // El menú de compartir ya tomó su copia; no dejamos el archivo en claro en el caché.
  setTimeout(() => deleteQuietly(file.uri), 120_000);
}

export async function exportTransactionsCsv(): Promise<number> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    occurred_at: number; merchant: string | null; cat: string | null; type: string; amount: number; payment_method: string; note: string | null;
  }>(
    `SELECT t.occurred_at, t.merchant, c.name AS cat, t.type, t.amount, t.payment_method, t.note
       FROM transactions t LEFT JOIN categories c ON c.id=t.category_id
      WHERE t.deleted_at IS NULL AND t.status='posted' ORDER BY t.occurred_at DESC`,
  );
  const head = ['Fecha', 'Descripción', 'Categoría', 'Tipo', 'Monto', 'Método', 'Nota'];
  // csvCell neutraliza fórmulas (=, +, -, @) para evitar inyección de fórmulas al abrir en Excel.
  const lines = rows.map((r) =>
    [new Date(r.occurred_at).toISOString().slice(0, 10), r.merchant, r.cat, r.type === 'income' ? 'Ingreso' : 'Gasto', r.amount, r.payment_method, r.note]
      .map(csvCell).join(','),
  );
  await shareText(`finzen-movimientos-${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + [head.join(','), ...lines].join('\n'), 'text/csv');
  return rows.length;
}

/** Copia de seguridad completa, CIFRADA con contraseña. */
export async function exportBackupJson(passphrase: string): Promise<void> {
  const db = await getDb();
  const tables: Record<string, unknown[]> = {};
  for (const t of USER_TABLES) tables[t] = await db.getAllAsync(`SELECT * FROM ${t}`);
  tables.settings = filterRestoredSettings(await db.getAllAsync("SELECT * FROM settings WHERE scope='user'"));
  tables.net_worth_snapshots = await db.getAllAsync('SELECT * FROM net_worth_snapshots');
  const plain = JSON.stringify({ app: 'finzen', version: BACKUP_VERSION, exportedAt: new Date().toISOString(), tables });
  const enc = await encryptBackup(plain, passphrase, (n) => Crypto.getRandomBytes(n));
  await shareText(`finzen-respaldo-${new Date().toISOString().slice(0, 10)}.finzen`, enc, 'application/json');
}

/** Restaura una copia REEMPLAZANDO los datos actuales. Valida todo antes de borrar nada. */
export async function restoreBackup(fileText: string, passphrase?: string): Promise<number> {
  let text = fileText;
  if (isEncryptedBackup(fileText)) {
    if (!passphrase) throw new Error('Este respaldo está cifrado: escribe su contraseña.');
    text = await decryptBackup(fileText, passphrase);
  }
  let data: { app?: string; version?: number; tables?: Record<string, unknown[]> };
  try { data = JSON.parse(text); } catch { throw new Error('El archivo no es un respaldo válido.'); }
  if (data.app !== 'finzen' || !data.tables || typeof data.tables !== 'object') throw new Error('El archivo no es un respaldo de FinZen.');
  if ((data.version ?? 0) > BACKUP_VERSION) throw new Error('El respaldo es de una versión más nueva de la app.');
  assertBackupSize(text, data.tables);

  const db = await getDb();
  let total = 0;
  await db.withTransactionAsync(async () => {
    await db.execAsync('PRAGMA defer_foreign_keys = ON');
    for (const t of [...USER_TABLES].reverse()) await db.runAsync(`DELETE FROM ${t}`);
    await db.runAsync('DELETE FROM net_worth_snapshots');
    await db.runAsync("DELETE FROM settings WHERE scope='user'");
    await db.runAsync('DELETE FROM sync_queue');

    for (const t of [...USER_TABLES, 'net_worth_snapshots'] as string[]) {
      const cols = new Set((await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${t})`)).map((c) => c.name));
      for (const row of data.tables![t] ?? []) {
        if (!isPlainRow(row)) throw new Error(`Fila inválida en "${t}": el respaldo está dañado.`);
        const keys = Object.keys(row).filter((k) => cols.has(k)); // nombres de columna solo si existen en el esquema
        if (!keys.length) continue;
        await db.runAsync(
          `INSERT OR REPLACE INTO ${t} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
          keys.map((k) => row[k] as string | number | null),
        );
        total++;
      }
    }
    // Ajustes: solo una lista cerrada y siempre como ajustes de usuario (nunca de dispositivo).
    for (const s of filterRestoredSettings(data.tables!.settings)) {
      await db.runAsync('INSERT OR REPLACE INTO settings (key,value,scope,updated_at) VALUES (?,?,?,?)', [s.key, s.value, s.scope, s.updated_at]);
      total++;
    }
    await db.execAsync(seedCategoriesSql(Date.now())); // por si el respaldo no traía categorías
  });
  return total;
}

export interface CsvPreview {
  header: string[];
  map: ColumnMap | null;
  rows: string[][];
}

export function previewCsv(text: string): CsvPreview {
  const all = parseCsv(text);
  if (all.length > MAX_CSV_ROWS + 1) throw new Error(`El archivo tiene más de ${MAX_CSV_ROWS} filas.`);
  const header = all[0] ?? [];
  return { header, map: guessColumns(header), rows: all.slice(1) };
}

/**
 * Importa un extracto. No toca saldos de cuentas (son movimientos históricos) y no duplica
 * al reimportar el mismo archivo (hash por fecha+descripción+monto).
 */
export async function importCsvRows(
  rows: string[][], map: ColumnMap, positiveIsIncome?: boolean,
): Promise<{ imported: number; duplicates: number; skipped: number }> {
  const db = await getDb();
  const mapped = mapRows(rows, map, positiveIsIncome);
  let imported = 0;
  let duplicates = 0;
  const now = Date.now();
  for (const r of mapped.rows) {
    const exists = await db.getFirstAsync('SELECT id FROM transactions WHERE dedupe_hash=?', [r.dedupe]);
    if (exists) { duplicates++; continue; }
    const cat = r.type === 'income' ? 'cat_ingreso_otros' : (await suggestCategory(r.description)) ?? 'cat_otros';
    await db.withTransactionAsync(async () => {
      const id = uid();
      const row = {
        id, account_id: null, category_id: cat, debt_id: null, type: r.type, amount: r.amount,
        merchant: r.description.slice(0, 80) || null, note: null, occurred_at: r.occurredAt, source: 'csv',
        payment_method: 'unknown', status: 'posted', dedupe_hash: r.dedupe, created_at: now, updated_at: now, deleted_at: null,
      };
      const cols = Object.keys(row);
      await db.runAsync(`INSERT INTO transactions (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, Object.values(row) as (string | number | null)[]);
      await db.runAsync('INSERT INTO sync_queue (table_name,row_id,op,payload,created_at) VALUES (?,?,?,?,?)', ['transactions', id, 'upsert', JSON.stringify(row), now]);
    });
    imported++;
  }
  return { imported, duplicates, skipped: mapped.skipped };
}

/** Lee un archivo elegido con el selector y BORRA la copia temporal. Tope de tamaño. */
export async function readPickedFile(uri: string, maxBytes = MAX_IMPORT_BYTES): Promise<string> {
  try {
    const f = new File(uri);
    if ((f.size ?? 0) > maxBytes) throw new Error(`El archivo es demasiado grande (máximo ${Math.round(maxBytes / 1_000_000)} MB).`);
    return await f.text();
  } finally {
    deleteQuietly(uri);
  }
}

/**
 * Borra TODO lo del usuario en este celular: datos, PIN, claves de IA y de sincronización,
 * cola y lista de apps del lector de notificaciones, avisos programados y archivos temporales.
 * secure_delete + VACUUM sobrescriben las páginas borradas de la base. Irreversible.
 */
export async function wipeAllData(): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.execAsync('PRAGMA defer_foreign_keys = ON');
    for (const t of [...USER_TABLES].reverse()) await db.runAsync(`DELETE FROM ${t}`);
    for (const t of ['net_worth_snapshots', 'sync_queue', 'notifications_log', 'settings']) await db.runAsync(`DELETE FROM ${t}`);
    await db.runAsync('UPDATE notification_sources SET bound_package=NULL');
    await db.execAsync(seedCategoriesSql(Date.now())); // las categorías predefinidas siempre existen
  });
  await db.execAsync('VACUUM');

  await clearSyncCredentials();
  await clearPin();
  await clearGeminiKey();
  NotificationListener.drain();
  NotificationListener.clearSeen();
  NotificationListener.setLearningMode(false);
  await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
  cleanTempFiles();
}
