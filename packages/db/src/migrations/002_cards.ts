/**
 * Migración 002 — tarjetas de crédito, planes de cuotas y patrimonio histórico.
 *
 *  - credit_limit / cut_day: cupo y día de corte de la tarjeta.
 *  - parent_debt_id: un plan de cuotas (compra diferida) pertenece a una tarjeta.
 *    Un plan se guarda como deuda con kind='loan' (o 'bnpl' si es Addi/Sistecrédito sin tarjeta)
 *    y parent_debt_id apuntando a la tarjeta; así no hay que reconstruir la tabla por el CHECK de `kind`.
 *  - net_worth_snapshots: foto mensual del patrimonio para la gráfica de evolución. Local (se recalcula).
 */
export const MIGRATION_002_CARDS = /* sql */ `
ALTER TABLE debts ADD COLUMN credit_limit INTEGER;
ALTER TABLE debts ADD COLUMN cut_day INTEGER;
ALTER TABLE debts ADD COLUMN parent_debt_id TEXT REFERENCES debts(id);
CREATE INDEX idx_debts_parent ON debts(parent_debt_id) WHERE parent_debt_id IS NOT NULL;

CREATE TABLE net_worth_snapshots (
  month        TEXT PRIMARY KEY,   -- 'YYYY-MM'
  assets       INTEGER NOT NULL,
  liabilities  INTEGER NOT NULL,
  net          INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
`;
