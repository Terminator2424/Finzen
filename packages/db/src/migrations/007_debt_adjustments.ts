/**
 * Migración 007 — historial de ajustes de deudas (aumentos, pagos y correcciones).
 * Solo local (no se sincroniza). El saldo real vive en debts.balance; esto es el rastro.
 */
export const MIGRATION_007_DEBT_ADJUSTMENTS = /* sql */ `
CREATE TABLE debt_adjustments (
  id          TEXT PRIMARY KEY,
  debt_id     TEXT NOT NULL REFERENCES debts(id),
  kind        TEXT NOT NULL CHECK (kind IN ('increase','decrease','payment')),
  amount      INTEGER NOT NULL CHECK (amount > 0),
  note        TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_debt_adjustments_debt ON debt_adjustments(debt_id, created_at DESC);
`;