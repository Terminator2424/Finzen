import { getDb } from './db';
import { payCapital } from './debts';
import { patchRow, uid, type Db } from './repo';

/**
 * Ajustes de deudas: aumentar, pagar (abono a capital) y corregir a la baja. Cada ajuste deja rastro en
 * debt_adjustments. Los planes con calendario de cuotas NO admiten ajustar el saldo suelto (se descuadrarían
 * de la tabla de cuotas): ahí se marca la cuota como pagada.
 */
export type AdjustKind = 'increase' | 'decrease' | 'payment';
export interface DebtAdjustment { id: string; kind: AdjustKind; amount: number; note: string | null; created_at: number }

async function adjustable(db: Db, debtId: string): Promise<{ balance: number; principal: number }> {
  const d = await db.getFirstAsync<{ balance: number; principal: number; installments_total: number | null }>(
    'SELECT balance, principal, installments_total FROM debts WHERE id=? AND deleted_at IS NULL', [debtId],
  );
  if (!d) throw new Error('La deuda ya no existe');
  if (d.installments_total !== null) {
    throw new Error('Este plan tiene calendario de cuotas: marca la cuota como pagada. Para cambiar el monto total hay que registrar la compra de nuevo.');
  }
  return d;
}

async function log(db: Db, debtId: string, kind: AdjustKind, amount: number, note: string | null) {
  await db.runAsync(
    'INSERT INTO debt_adjustments (id,debt_id,kind,amount,note,created_at) VALUES (?,?,?,?,?,?)',
    [uid(), debtId, kind, amount, note?.trim().slice(0, 120) || null, Date.now()],
  );
}

const positive = (n: number) => {
  const v = Math.round(n);
  if (!(v > 0)) throw new Error('El monto debe ser mayor a cero');
  return v;
};

/** Te prestaron más (o gastaste más en la tarjeta): sube el saldo y el monto original. Reactiva una deuda pagada. */
export async function increaseDebt(debtId: string, amount: number, note: string | null): Promise<void> {
  const value = positive(amount);
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const d = await adjustable(db, debtId);
    await patchRow(db, 'debts', debtId, { balance: d.balance + value, principal: d.principal + value, status: 'active' });
    await log(db, debtId, 'increase', value, note);
  });
}

/** Corrección a la baja (te perdonaron una parte o corriges un error): baja el saldo sin mover dinero. */
export async function decreaseDebt(debtId: string, amount: number, note: string | null): Promise<void> {
  const value = positive(amount);
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const d = await adjustable(db, debtId);
    const applied = Math.min(value, d.balance);
    if (!(applied > 0)) throw new Error('Esta deuda ya está en cero');
    const balance = d.balance - applied;
    await patchRow(db, 'debts', debtId, { balance, status: balance === 0 ? 'paid' : 'active' });
    await log(db, debtId, 'decrease', applied, note);
  });
}

/** Pago a capital: sin cuenta = en persona o efectivo (no toca ningún saldo); con cuenta, se descuenta de ella. */
export async function payDebtCapital(debtId: string, amount: number, accountId: string | null): Promise<void> {
  const value = positive(amount);
  const db = await getDb();
  const d = await adjustable(db, debtId);
  const applied = Math.min(value, d.balance);
  if (!(applied > 0)) throw new Error('Esta deuda ya está en cero');
  await payCapital(debtId, applied, accountId);
  await log(db, debtId, 'payment', applied, accountId ? 'Desde una cuenta' : 'En persona o efectivo');
}

/** Cambia el cupo de una tarjeta de crédito. */
export async function setCreditLimit(cardId: string, limit: number): Promise<void> {
  const value = positive(limit);
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const d = await db.getFirstAsync<{ kind: string }>('SELECT kind FROM debts WHERE id=? AND deleted_at IS NULL', [cardId]);
    if (!d) throw new Error('La tarjeta ya no existe');
    if (d.kind !== 'credit_card') throw new Error('Solo las tarjetas de crédito tienen cupo');
    await patchRow(db, 'debts', cardId, { credit_limit: value });
  });
}

export async function listAdjustments(debtId: string, limit = 6): Promise<DebtAdjustment[]> {
  const db = await getDb();
  return db.getAllAsync<DebtAdjustment>(
    'SELECT id, kind, amount, note, created_at FROM debt_adjustments WHERE debt_id=? ORDER BY created_at DESC LIMIT ?', [debtId, limit],
  );
}