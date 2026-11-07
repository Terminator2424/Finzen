import { MIGRATION_001_INIT } from './migrations/001_init';
import { MIGRATION_002_CARDS } from './migrations/002_cards';
import { MIGRATION_003_SOURCE_BINDING } from './migrations/003_source_binding';
import { MIGRATION_004_RECURRING } from './migrations/004_recurring_expenses';
import { MIGRATION_005_RECEIVABLES } from './migrations/005_receivables';
import { MIGRATION_006_SYSTEM_CATEGORIES } from './migrations/006_system_categories';
import { MIGRATION_007_DEBT_ADJUSTMENTS } from './migrations/007_debt_adjustments';

export { DEFAULT_CATEGORIES, seedCategoriesSql } from './seed';
export type { SeedCategory } from './seed';

/**
 * Abstracción mínima de SQLite: la implementan `expo-sqlite` (móvil) y
 * `tauri-plugin-sql` (PC) con un adaptador de 10 líneas. Así el runner de
 * migraciones es el mismo en ambas plataformas.
 */
export interface SqlExecutor {
  exec(sql: string): Promise<void>;
  getUserVersion(): Promise<number>;
  setUserVersion(version: number): Promise<void>;
}

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** Lista ordenada de migraciones. Nunca editar una ya publicada: añadir una nueva. */

export const MIGRATIONS: Migration[] = [
  { version: 1, name: 'init', sql: MIGRATION_001_INIT },
  { version: 2, name: 'cards', sql: MIGRATION_002_CARDS },
  { version: 3, name: 'source_binding', sql: MIGRATION_003_SOURCE_BINDING },
  { version: 4, name: 'recurring_expenses', sql: MIGRATION_004_RECURRING },
  { version: 5, name: 'receivables', sql: MIGRATION_005_RECEIVABLES },
  { version: 6, name: 'system_categories', sql: MIGRATION_006_SYSTEM_CATEGORIES },
  { version: 7, name: 'debt_adjustments', sql: MIGRATION_007_DEBT_ADJUSTMENTS }, // <-- NUEVA
];

/** Aplica las migraciones pendientes usando PRAGMA user_version como marcador. */
export async function runMigrations(db: SqlExecutor): Promise<number> {
  const current = await db.getUserVersion();
  let applied = current;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    await db.exec('BEGIN');
    try {
      await db.exec(m.sql);
      await db.exec('COMMIT');
    } catch (err) {
      await db.exec('ROLLBACK');
      throw err;
    }
    await db.setUserVersion(m.version);
    applied = m.version;
  }
  return applied;
}

/** Tablas que se sincronizan con Supabase (las demás son solo locales). */
export const SYNCED_TABLES = [
  'accounts',
  'categories',
  'debts',
  'debt_installments',
  'transactions',
  'budgets',
  'categorization_rules',
] as const;
