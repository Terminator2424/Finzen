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

export interface AssignableExpense { id: string; merchant: string | null; amount: number; occurred_at: number; account: string | null }

/** Gastos de los últimos 30 días que se pueden convertir en pago de una deuda. */
export async function listAssignableExpenses(limit = 10): Promise<AssignableExpense[]> {
  const db = await getDb();
  return db.getAllAsync<AssignableExpense>(
    `SELECT t.id, t.merchant, t.amount, t.occurred_at, a.name AS account
       FROM transactions t LEFT JOIN accounts a ON a.id = t.account_id
      WHERE t.deleted_at IS NULL AND t.type='expense' AND t.status='posted' AND t.debt_id IS NULL
        AND COALESCE(t.category_id,'') NOT IN ('cat_deudas','cat_transferencia','cat_transferencia_in','cat_cobro')
        AND t.occurred_at >= ?
      ORDER BY t.occurred_at DESC LIMIT ?`,
    [Date.now() - 30 * 86_400_000, limit],
  );
}

/**
 * Convierte un gasto ya registrado en pago de una deuda: baja la deuda (o marca la próxima cuota si es un plan con
 * calendario y el valor coincide), el movimiento pasa a "Pago de deudas" (deja de ser gasto del mes) y la cuenta NO se
 * vuelve a mover, porque el dinero ya salió cuando se registró el gasto.
 */
export async function assignExpenseToDebt(txId: string, debtId: string): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const tx = await db.getFirstAsync<{ type: string; amount: number; status: string; debt_id: string | null; category_id: string | null; merchant: string | null }>(
      'SELECT type, amount, status, debt_id, category_id, merchant FROM transactions WHERE id=? AND deleted_at IS NULL', [txId],
    );
    if (!tx) throw new Error('Ese movimiento ya no existe');
    if (tx.type !== 'expense' || tx.status !== 'posted') throw new Error('Solo se puede asignar un gasto ya registrado');
    if (tx.debt_id || ['cat_deudas', 'cat_transferencia', 'cat_transferencia_in', 'cat_cobro'].includes(tx.category_id ?? '')) {
      throw new Error('Ese movimiento ya está ligado a una deuda o es una transferencia');
    }
    const d = await db.getFirstAsync<{ name: string; balance: number; installments_total: number | null }>(
      'SELECT name, balance, installments_total FROM debts WHERE id=? AND deleted_at IS NULL', [debtId],
    );
    if (!d) throw new Error('La deuda ya no existe');
    if (d.installments_total !== null) {
      const inst = await db.getFirstAsync<{ id: string; principal: number; total: number }>(
        'SELECT id, principal, total FROM debt_installments WHERE debt_id=? AND paid_at IS NULL AND deleted_at IS NULL ORDER BY number LIMIT 1', [debtId],
      );
      if (!inst) throw new Error('Este plan no tiene cuotas pendientes');
      if (Math.abs(inst.total - tx.amount) > Math.max(1, Math.round(inst.total * 0.005))) {
        throw new Error(`El valor no coincide con la próxima cuota (${inst.total}). Para otro monto, registra el pago desde la cuota.`);
      }
      await patchRow(db, 'debt_installments', inst.id, { paid_at: Date.now() });
      const left = await db.getFirstAsync<{ n: number }>(
        'SELECT COUNT(*) AS n FROM debt_installments WHERE debt_id=? AND paid_at IS NULL AND deleted_at IS NULL AND id<>?', [debtId, inst.id],
      );
      await patchRow(db, 'debts', debtId, { balance: Math.max(0, d.balance - inst.principal), status: (left?.n ?? 0) === 0 ? 'paid' : 'active' });
    } else {
      const applied = Math.min(tx.amount, d.balance);
      if (!(applied > 0)) throw new Error('Esta deuda ya está en cero');
      const balance = d.balance - applied;
      await patchRow(db, 'debts', debtId, { balance, status: balance === 0 ? 'paid' : 'active' });
      await log(db, debtId, 'payment', applied, 'Asignado desde un gasto');
    }
    await patchRow(db, 'transactions', txId, {
      category_id: 'cat_deudas', debt_id: debtId, merchant: `Pago · ${d.name}`, note: tx.merchant ? `Antes: ${tx.merchant}` : null,
    });
  });
}