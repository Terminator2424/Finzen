import { getDb } from './db';

/**
 * Movimientos leídos de notificaciones que NO cayeron en ninguna cuenta: no mueven ningún saldo,
 * así que no cambian los activos. Pasa cuando no existe una cuenta con el nombre de la app (por ejemplo "Nu" o "Nequi").
 */
export async function countUnassigned(): Promise<number> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM transactions
      WHERE deleted_at IS NULL AND source='notification' AND status='posted'
        AND account_id IS NULL AND debt_id IS NULL
        AND COALESCE(category_id,'') NOT IN ('cat_deudas','cat_transferencia','cat_transferencia_in','cat_cobro')`,
  );
  return r?.n ?? 0;
}