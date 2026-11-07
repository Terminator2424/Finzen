import { getDb } from './db';
import { deleteTransaction } from './transactions';

export interface AutoTx {
  id: string;
  type: 'expense' | 'income';
  amount: number;
  merchant: string | null;
  account: string | null;
  created_at: number;
}

/**
 * Movimientos que FinZen registró solo (desde notificaciones) a partir de `sinceMs`, los más recientes primero.
 * Los cobros de deuda se excluyen: borrarlos no reabre el cobro.
 */
export async function listRecentAuto(sinceMs: number, limit = 5): Promise<AutoTx[]> {
  const db = await getDb();
  return db.getAllAsync<AutoTx>(
    `SELECT t.id, t.type, t.amount, t.merchant, a.name AS account, t.created_at
       FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id
      WHERE t.deleted_at IS NULL AND t.source='notification' AND t.status='posted' AND t.created_at >= ?
        AND COALESCE(t.category_id,'') <> 'cat_cobro'
      ORDER BY t.created_at DESC LIMIT ?`,
    [sinceMs, limit],
  );
}

/** Deshace un movimiento automático: revierte saldos y, si es una transferencia, borra las dos mitades. */
export async function undoAuto(id: string): Promise<boolean> {
  return deleteTransaction(id);
}