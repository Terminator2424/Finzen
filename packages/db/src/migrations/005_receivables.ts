/**
 * Migración 005 — cuentas por cobrar ("me deben").
 * Solo local (no se sincroniza con Supabase). `paid` acumula los pagos; el saldo es amount - paid.
 */
export const MIGRATION_005_RECEIVABLES = /* sql */ `
CREATE TABLE receivables (
  id          TEXT PRIMARY KEY,
  debtor      TEXT NOT NULL,
  amount      INTEGER NOT NULL CHECK (amount > 0),
  paid        INTEGER NOT NULL DEFAULT 0 CHECK (paid >= 0),
  due_date    TEXT,                       -- 'YYYY-MM-DD' o NULL (sin fecha)
  note        TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);
CREATE TABLE receivable_payments (
  id             TEXT PRIMARY KEY,
  receivable_id  TEXT NOT NULL REFERENCES receivables(id),
  amount         INTEGER NOT NULL CHECK (amount > 0),
  paid_at        INTEGER NOT NULL
);
CREATE INDEX idx_receivables_open ON receivables(due_date) WHERE deleted_at IS NULL AND paid < amount;
`;