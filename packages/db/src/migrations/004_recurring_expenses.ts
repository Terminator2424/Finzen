/**
 * Migración 004 — Gastos fijos y suscripciones.
 * Permite guardar pagos recurrentes (arriendo, Netflix, etc.) para proyectar el dinero.
 */
export const MIGRATION_004_RECURRING = /* sql */ `
CREATE TABLE recurring_expenses (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  amount      INTEGER NOT NULL CHECK (amount >= 0),
  day_of_month INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
  category_id TEXT REFERENCES categories(id),
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);
`;