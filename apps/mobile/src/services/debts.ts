import { monthlyRateFromEA, planFromMode, summarizeCard, todayString, type CardSummary, type PlanInput } from '@finzen/core';
import { getDb } from './db';
import { adjustAccount, patchRow, softDelete, uid, writeRow, type Db } from './repo';

export type DebtKind = 'credit_card' | 'loan' | 'bnpl' | 'informal';
export const DEBT_KIND_LABEL: Record<DebtKind, string> = {
  credit_card: 'Tarjeta de crédito', loan: 'Crédito', bnpl: 'Compra a cuotas (Addi, Sistecrédito…)', informal: 'Deuda informal',
};

export interface Debt {
  id: string; name: string; kind: DebtKind; provider: string | null;
  principal: number; balance: number;
  installments_total: number | null; monthly_payment: number | null; monthly_rate: number;
  fixed_fee_per_installment: number;
  due_day: number | null; cut_day: number | null; credit_limit: number | null;
  first_due_date: string | null; status: 'active' | 'paid'; parent_debt_id: string | null;
}

export interface Installment {
  id: string; debt_id: string; number: number; due_date: string;
  principal: number; interest: number; fee: number; total: number; paid_at: number | null;
}

// ───────────── Alta de deudas / tarjetas ─────────────
export interface DebtInput {
  name: string; kind: DebtKind; provider?: string | null;
  balance: number; monthlyPayment: number;
  /** Tasa efectiva anual en %. 0 si no tiene. */
  annualRatePct: number;
  dueDay: number | null;
  cutDay?: number | null;
  creditLimit?: number | null;
}

export async function createDebt(d: DebtInput): Promise<string> {
  const db = await getDb();
  const now = Date.now();
  const id = uid();
  await db.withTransactionAsync(() =>
    writeRow(db, 'debts', {
      id, name: d.name, kind: d.kind, provider: d.provider ?? null,
      principal: d.balance, balance: d.balance, installments_total: null,
      monthly_payment: d.monthlyPayment || null,
      monthly_rate: d.annualRatePct > 0 ? monthlyRateFromEA(d.annualRatePct / 100) : 0,
      fixed_fee_per_installment: 0, due_day: d.dueDay, first_due_date: null,
      status: 'active', origin_transaction_id: null,
      credit_limit: d.creditLimit ?? null, cut_day: d.cutDay ?? null, parent_debt_id: null,
      created_at: now, updated_at: now, deleted_at: null,
    }),
  );
  return id;
}

// ───────────── Consultas ─────────────
const COLS =
  'id,name,kind,provider,principal,balance,installments_total,monthly_payment,monthly_rate,fixed_fee_per_installment,due_day,cut_day,credit_limit,first_due_date,status,parent_debt_id';

/** Deudas de primer nivel (tarjetas, créditos, BNPL). Los planes de una tarjeta cuelgan de ella. */
export async function listDebts(): Promise<Debt[]> {
  const db = await getDb();
  return db.getAllAsync<Debt>(
    `SELECT ${COLS} FROM debts WHERE deleted_at IS NULL AND status='active' AND parent_debt_id IS NULL ORDER BY created_at`,
  );
}

export async function listPlansOf(cardId: string): Promise<Debt[]> {
  const db = await getDb();
  return db.getAllAsync<Debt>(
    `SELECT ${COLS} FROM debts WHERE deleted_at IS NULL AND parent_debt_id=? ORDER BY created_at`, [cardId],
  );
}

export async function getDebt(id: string): Promise<Debt | null> {
  const db = await getDb();
  return db.getFirstAsync<Debt>(`SELECT ${COLS} FROM debts WHERE id=? AND deleted_at IS NULL`, [id]);
}

export async function listCards(): Promise<Debt[]> {
  const db = await getDb();
  return db.getAllAsync<Debt>(
    `SELECT ${COLS} FROM debts WHERE deleted_at IS NULL AND kind='credit_card' AND status='active' ORDER BY created_at`,
  );
}

export async function getInstallments(debtId: string): Promise<Installment[]> {
  const db = await getDb();
  return db.getAllAsync<Installment>(
    'SELECT id,debt_id,number,due_date,principal,interest,fee,total,paid_at FROM debt_installments WHERE debt_id=? AND deleted_at IS NULL ORDER BY number',
    [debtId],
  );
}

export async function cardSummary(card: Debt): Promise<CardSummary> {
  const plans = await listPlansOf(card.id);
  return summarizeCard({
    creditLimit: card.credit_limit ?? 0,
    revolvingBalance: card.balance,
    planBalances: plans.filter((p) => p.status === 'active').map((p) => p.balance),
    cutDay: card.cut_day, dueDay: card.due_day, monthlyRate: card.monthly_rate, today: todayString(),
  });
}

export interface UpcomingPayment { debtName: string; installmentId: string; dueDate: string; total: number; number: number; of: number | null }

/** Próximas cuotas sin pagar (de todos los planes), ordenadas por fecha. */
export async function upcomingPayments(limit = 5): Promise<UpcomingPayment[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ name: string; id: string; due_date: string; total: number; number: number; installments_total: number | null }>(
    `SELECT d.name, i.id, i.due_date, i.total, i.number, d.installments_total
       FROM debt_installments i JOIN debts d ON d.id = i.debt_id
      WHERE i.paid_at IS NULL AND i.deleted_at IS NULL AND d.deleted_at IS NULL AND d.status='active'
      ORDER BY i.due_date LIMIT ?`, [limit],
  );
  return rows.map((r) => ({ debtName: r.name, installmentId: r.id, dueDate: r.due_date, total: r.total, number: r.number, of: r.installments_total }));
}

// ───────────── Planes de cuotas ─────────────
export interface PlanParams extends Omit<PlanInput, 'principal'> {
  name: string;
  provider: string | null;
  /** Tarjeta a la que pertenece el plan; null = BNPL suelto (Addi, Sistecrédito). */
  parentDebtId: string | null;
  principal: number;
}

/**
 * Crea la deuda-plan y su calendario de cuotas. Debe llamarse dentro de una transacción abierta.
 * Devuelve el id del plan y el resumen para mostrar al usuario.
 */
export async function insertPlan(db: Db, p: PlanParams, originTxId: string | null): Promise<{ id: string; monthlyPayment: number }> {
  const plan = planFromMode({ principal: p.principal, installments: p.installments, firstDueDate: p.firstDueDate, mode: p.mode });
  const now = Date.now();
  const id = uid();
  const first = plan.schedule[0]!;
  await writeRow(db, 'debts', {
    id, name: p.name, kind: p.parentDebtId ? 'loan' : 'bnpl', provider: p.provider,
    principal: p.principal, balance: p.principal,
    installments_total: p.installments, monthly_payment: first.total, monthly_rate: plan.monthlyRate,
    fixed_fee_per_installment: plan.feePerInstallment,
    due_day: Number(p.firstDueDate.slice(8, 10)), first_due_date: p.firstDueDate,
    status: 'active', origin_transaction_id: originTxId,
    credit_limit: null, cut_day: null, parent_debt_id: p.parentDebtId,
    created_at: now, updated_at: now, deleted_at: null,
  });
  for (const r of plan.schedule) {
    await writeRow(db, 'debt_installments', {
      id: uid(), debt_id: id, number: r.number, due_date: r.dueDate,
      principal: r.principal, interest: r.interest, fee: r.fee, total: r.total,
      paid_at: null, created_at: now, updated_at: now, deleted_at: null,
    });
  }
  return { id, monthlyPayment: first.total };
}

// ───────────── Pagos ─────────────
/** Marca una cuota como pagada, baja el saldo del plan y (opcional) descuenta de una cuenta. */
export async function payInstallment(installmentId: string, accountId: string | null): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const inst = await db.getFirstAsync<Installment>(
      'SELECT id,debt_id,number,due_date,principal,interest,fee,total,paid_at FROM debt_installments WHERE id=?', [installmentId],
    );
    if (!inst || inst.paid_at) return;
    const debt = await db.getFirstAsync<{ balance: number; name: string }>('SELECT balance,name FROM debts WHERE id=?', [inst.debt_id]);
    if (!debt) return;

    await patchRow(db, 'debt_installments', installmentId, { paid_at: Date.now() });
    const balance = Math.max(0, debt.balance - inst.principal);
    const pending = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM debt_installments WHERE debt_id=? AND paid_at IS NULL AND deleted_at IS NULL AND id<>?',
      [inst.debt_id, installmentId],
    );
    await patchRow(db, 'debts', inst.debt_id, { balance, status: (pending?.n ?? 0) === 0 ? 'paid' : 'active' });
    await recordDebtPayment(db, `Cuota ${inst.number} · ${debt.name}`, inst.total, accountId, inst.debt_id);
  });
}

/** Abono a la tarjeta (reduce el saldo rotativo). */
export async function payCard(cardId: string, amount: number, accountId: string | null): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const card = await db.getFirstAsync<{ balance: number; name: string }>('SELECT balance,name FROM debts WHERE id=?', [cardId]);
    if (!card || amount <= 0) return;
    await patchRow(db, 'debts', cardId, { balance: Math.max(0, card.balance - amount) });
    await recordDebtPayment(db, `Pago tarjeta · ${card.name}`, amount, accountId, cardId);
  });
}

/**
 * Registra el pago como gasto en la categoría "Pago de deudas" (y baja la cuenta si se indicó).
 * Esa categoría se excluye de "gastos del mes": la compra ya se contó cuando se hizo.
 */
async function recordDebtPayment(db: Db, label: string, amount: number, accountId: string | null, debtId: string) {
  const now = Date.now();
  await writeRow(db, 'transactions', {
    id: uid(), account_id: accountId, category_id: 'cat_deudas', debt_id: debtId, type: 'expense', amount,
    merchant: label, note: null, occurred_at: now, source: 'manual', payment_method: accountId ? 'debit' : 'unknown',
    status: 'posted', dedupe_hash: null, created_at: now, updated_at: now, deleted_at: null,
  });
  if (accountId) await adjustAccount(db, accountId, -amount);
}

export async function deleteDebt(id: string): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const children = await db.getAllAsync<{ id: string }>('SELECT id FROM debts WHERE parent_debt_id=? AND deleted_at IS NULL', [id]);
    for (const debtId of [id, ...children.map((c) => c.id)]) {
      const insts = await db.getAllAsync<{ id: string }>('SELECT id FROM debt_installments WHERE debt_id=? AND deleted_at IS NULL', [debtId]);
      for (const i of insts) await softDelete(db, 'debt_installments', i.id);
      await softDelete(db, 'debts', debtId);
    }
  });


}

/**
 * NUEVA FUNCIÓN: Abona un monto libre a capital de cualquier deuda (préstamo, BNPL, informal).
 * Reduce el saldo, actualiza el estado a 'paid' si llega a 0, y registra el gasto.
 */
export async function payCapital(debtId: string, amount: number, accountId: string | null): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const debt = await db.getFirstAsync<{ balance: number; name: string }>('SELECT balance,name FROM debts WHERE id=?', [debtId]);
    if (!debt || amount <= 0) return;

    // 1. Calculamos el nuevo saldo
    const newBalance = Math.max(0, debt.balance - amount);
    // 2. Si el saldo llega a 0, marcamos la deuda como pagada
    const newStatus = newBalance === 0 ? 'paid' : 'active';

    // 3. Actualizamos la deuda
    await patchRow(db, 'debts', debtId, { balance: newBalance, status: newStatus });
    
    // 4. Registramos el movimiento en el historial y descontamos de la cuenta
    await recordDebtPayment(db, `Abono a capital · ${debt.name}`, amount, accountId, debtId);
  });
}
