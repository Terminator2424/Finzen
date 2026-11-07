/**
 * Migración 006 — categorías del sistema para transferencias y cobros.
 * Se insertan aquí (y no solo en la semilla) para que existan también en instalaciones ya abiertas:
 * transactions.category_id es clave foránea.
 */
export const MIGRATION_006_SYSTEM_CATEGORIES = /* sql */ `
INSERT OR IGNORE INTO categories (id,name,parent_id,kind,is_system,created_at,updated_at) VALUES
  ('cat_transferencia','Transferencia entre mis cuentas',NULL,'expense',1,1,1),
  ('cat_transferencia_in','Transferencia entre mis cuentas',NULL,'income',1,1,1),
  ('cat_cobro','Cobro de deuda',NULL,'income',1,1,1);
`;