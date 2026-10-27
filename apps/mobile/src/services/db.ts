import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import * as FS from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import { runMigrations, seedCategoriesSql, type SqlExecutor } from '@finzen/db';
import { DEFAULT_SOURCES } from '@finzen/core';

/**
 * Base de datos local, CIFRADA EN REPOSO con SQLCipher (AES-256).
 *
 *  - La clave (256 bits aleatorios) se genera en el primer arranque y vive en SecureStore,
 *    que en Android la protege con el Keystore del hardware. Nunca sale del celular.
 *  - Quien copie el archivo de la base (backup, root, cable) solo ve bytes aleatorios.
 *  - Si existe una base antigua SIN cifrar (versiones previas), se migra sola y la vieja se borra.
 *  - Si por cualquier razón SQLCipher no está disponible (p. ej. un APK antiguo), la app NO se
 *    rompe: usa la base sin cifrar y lo avisa en Ajustes → Diagnóstico (`isDbEncrypted()`).
 *  - Cada instalación crea su propia base: el repositorio nunca contiene datos de nadie.
 */
const LEGACY_NAME = 'finzen.db';
const SECURE_NAME = 'finzen_secure.db';
const KEY_NAME = 'finzen_db_key';

let encrypted = false;
export const isDbEncrypted = () => encrypted;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= init().catch((e) => {
    dbPromise = null; // permite reintentar tras un fallo
    throw e;
  });
  return dbPromise;
}

async function getOrCreateKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_NAME);
  if (existing && /^[0-9a-f]{64}$/.test(existing)) return existing;
  const bytes = Crypto.getRandomBytes(32);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(KEY_NAME, hex);
  return hex;
}

const keyPragma = (key: string) => `PRAGMA key = "x'${key}'";`;
const exists = async (name: string) => (await FS.getInfoAsync(`file://${SQLite.defaultDatabaseDirectory}/${name}`)) as { exists: boolean; size?: number };

/** Abre la base cifrada y comprueba que SQLCipher esté activo y que la clave sirva. */
async function openSecure(key: string): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(SECURE_NAME);
  try {
    await db.execAsync(keyPragma(key));
    // Con SQLite normal este PRAGMA no devuelve nada: significaría que "cifrar" no cifró.
    if (!(await db.getFirstAsync('PRAGMA cipher_version'))) throw new Error('SQLCipher no está disponible en este build');
    await db.getFirstAsync('SELECT count(*) FROM sqlite_master'); // falla si la clave no corresponde
    return db;
  } catch (e) {
    await db.closeAsync().catch(() => {});
    throw e;
  }
}

/** Copia la base antigua sin cifrar a la cifrada (sqlcipher_export) y borra la antigua. */
async function migrateLegacy(key: string): Promise<void> {
  if (!(await exists(LEGACY_NAME)).exists) return;

  // ¿Ya se migró antes y solo faltó borrar la vieja? Se comprueba que la cifrada tenga datos.
  const secureInfo = await exists(SECURE_NAME);
  if (secureInfo.exists && (secureInfo.size ?? 0) > 0) {
    try {
      const probe = await openSecure(key);
      const tables = (await probe.getFirstAsync<{ n: number }>("SELECT count(*) AS n FROM sqlite_master WHERE type='table'"))?.n ?? 0;
      await probe.closeAsync();
      if (tables > 0) { await removeLegacy(); return; }
    } catch { /* cifrada ilegible o vacía: se rehace */ }
    await SQLite.deleteDatabaseAsync(SECURE_NAME).catch(() => {});
  }

  const legacy = await SQLite.openDatabaseAsync(LEGACY_NAME);
  try {
    const ver = (await legacy.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
    const target = `${SQLite.defaultDatabaseDirectory}/${SECURE_NAME}`.replace(/'/g, "''");
    await legacy.execAsync(`ATTACH DATABASE '${target}' AS enc KEY "x'${key}'";`);
    await legacy.execAsync("SELECT sqlcipher_export('enc');");
    await legacy.execAsync(`PRAGMA enc.user_version = ${Number(ver)};`);
    await legacy.execAsync('DETACH DATABASE enc;');
  } finally {
    await legacy.closeAsync().catch(() => {});
  }

  // Solo se borra la antigua si la nueva abre bien y trae las mismas tablas.
  const check = await openSecure(key);
  const n = (await check.getFirstAsync<{ n: number }>("SELECT count(*) AS n FROM sqlite_master WHERE type='table'"))?.n ?? 0;
  await check.closeAsync();
  if (n === 0) throw new Error('La migración a base cifrada no copió tablas');
  await removeLegacy();
}

async function removeLegacy(): Promise<void> {
  await SQLite.deleteDatabaseAsync(LEGACY_NAME).catch(() => {});
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    await FS.deleteAsync(`file://${SQLite.defaultDatabaseDirectory}/${LEGACY_NAME}${suffix}`, { idempotent: true }).catch(() => {});
  }
}

async function open(): Promise<SQLite.SQLiteDatabase> {
  try {
    const key = await getOrCreateKey();
    await migrateLegacy(key);
    const db = await openSecure(key);
    encrypted = true;
    return db;
  } catch (e) {
    console.warn('Base cifrada no disponible; se usa la base sin cifrar', e);
    encrypted = false;
    return SQLite.openDatabaseAsync(LEGACY_NAME);
  }
}

async function init() {
  const db = await open();
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON;');

  const exec: SqlExecutor = {
    exec: (sql) => db.execAsync(sql),
    getUserVersion: async () =>
      (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0,
    setUserVersion: (v) => db.execAsync(`PRAGMA user_version = ${Number(v)}`),
  };
  await runMigrations(exec);

  await db.execAsync(seedCategoriesSql(Date.now()));
  
  // ❌ SE ELIMINÓ EL BUCLE QUE INSERTABA LAS APPS POR DEFECTO

  return db;
}
