import { describe, expect, it } from 'vitest';
import { MIGRATIONS, runMigrations, seedCategoriesSql, type SqlExecutor } from './index';

// node:sqlite viene incluido en Node >= 22.13; se obtiene así para que Vite no intente resolverlo.
const { DatabaseSync } = (process as any).getBuiltinModule('node:sqlite');

function memoryDb(): { db: any; exec: SqlExecutor } {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const exec: SqlExecutor = {
    exec: async (sql) => db.exec(sql),
    getUserVersion: async () => db.prepare('PRAGMA user_version').get().user_version,
    setUserVersion: async (v) => db.exec(`PRAGMA user_version = ${v}`),
  };
  return { db, exec };
}

describe('esquema SQLite', () => {
  it('aplica las migraciones y crea las 8 tablas pedidas más las de apoyo', async () => {
    const { db, exec } = memoryDb();
    const version = await runMigrations(exec);
    expect(version).toBe(MIGRATIONS.length);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r: any) => r.name);
    for (const t of [
      'accounts', 'transactions', 'categories', 'budgets', 'debts',
      'notifications_log', 'sync_queue', 'settings', 'debt_installments', 'net_worth_snapshots',
    ]) {
      expect(tables).toContain(t);
    }
  });

  it('es idempotente: una segunda ejecución no falla ni reaplica', async () => {
    const { exec } = memoryDb();
    await runMigrations(exec);
    await expect(runMigrations(exec)).resolves.toBe(MIGRATIONS.length);
  });

  it('inserta las categorías semilla y respeta las claves foráneas', async () => {
    const { db, exec } = memoryDb();
    await runMigrations(exec);
    db.exec(seedCategoriesSql(1));
    const n = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
    expect(n).toBeGreaterThanOrEqual(9);

    expect(() =>
      db.exec(
        "INSERT INTO transactions (id,category_id,type,amount,occurred_at,created_at,updated_at) VALUES ('t1','no-existe','expense',100,1,1,1)",
      ),
    ).toThrow();
  });

  it('rechaza montos no positivos y evita duplicados por dedupe_hash', async () => {
    const { db, exec } = memoryDb();
    await runMigrations(exec);
    const ins = (id: string, amount: number, hash: string) =>
      db.exec(
        `INSERT INTO transactions (id,type,amount,occurred_at,dedupe_hash,created_at,updated_at) VALUES ('${id}','expense',${amount},1,'${hash}',1,1)`,
      );
    expect(() => ins('a', 0, 'h1')).toThrow();
    ins('b', 5000, 'h2');
    expect(() => ins('c', 5000, 'h2')).toThrow();
  });
});
