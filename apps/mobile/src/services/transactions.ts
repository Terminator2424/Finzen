import { addMonthKey, categorize, monthKey, monthRange, type CategoryRule } from '@finzen/core';
import { getDb } from './db';
import { insertPlan, type PlanParams } from './debts';
import { adjustAccount, patchRow, softDelete, uid, writeRow, getOrCreateDefaultAccount } from './repo';

export type TxType = 'expense' | 'income';
export type PaymentMethod = 'cash' | 'debit' | 'credit' | 'bnpl' | 'unknown';
export type TxStatus = 'posted' | 'needs_review' | 'needs_installments';

export interface NewTx {
  type: TxType;
  amount: number;
  merchant: string | null;
  note?: string | null;
  categoryId: string | null;
  /** Cuenta que paga/recibe (débito, efectivo, ingreso). */
  accountId?: string | null;
  /** Tarjeta usada cuando paymentMethod = 'credit' (compra a 1 pago, saldo rotativo). */
  cardId?: string | null;
  occurredAt?: number;
  source?: 'manual' | 'notification' | 'ocr' | 'csv' | 'voice';
  paymentMethod?: PaymentMethod;
  status?: TxStatus;
  dedupeHash?: string | null;
}

export interface TxRow {
  id: string; type: TxType; amount: number; merchant: string | null; note: string | null;
  occurred_at: number; payment_method: PaymentMethod; status: TxStatus;
  category_id: string | null; category_name: string | null; account_id: string | null; debt_id: string | null;
}

function txRow(id: string, t: NewTx, debtId: string | null, now: number) {
  return {
    id, account_id: t.accountId ?? null, category_id: t.categoryId, debt_id: debtId,
    type: t.type, amount: Math.round(t.amount), merchant: t.merchant, note: t.note ?? null,
    occurred_at: t.occurredAt ?? now, source: t.source ?? 'manual',
    payment_method: t.paymentMethod ?? 'unknown', status: t.status ?? 'posted',
    dedupe_hash: t.dedupeHash ?? null, created_at: now, updated_at: now, deleted_at: null,
  };
}

/**
 * Registra una transacción y su efecto en saldos:
 *  - con cuenta (efectivo/débito/ingreso) → sube o baja el saldo de la cuenta
 *  - con tarjeta a 1 pago → sube el saldo rotativo de la tarjeta
 *  - pendiente de cuotas / sin cuenta → no toca saldos hasta resolverse
 */


/**
 * Registra una transacción y su efecto en saldos:
 *  - Si tiene cuenta (efectivo/débito/ingreso) → mueve el saldo de esa cuenta.
 *  - Si es tarjeta a 1 pago → sube el saldo rotativo de la tarjeta.
 *  - Si NO tiene cuenta → busca/crea la cuenta "Efectivo" y le aplica el movimiento.
 */
export async function createTransaction(t: NewTx): Promise<string> {
  const db = await getDb();
  if (t.amount <= 0) throw new Error('El monto debe ser mayor a cero');
  const id = uid();
  const now = Date.now();
  const status = t.status ?? 'posted';
  const useCard = t.paymentMethod === 'credit' && !!t.cardId && status === 'posted';

  await db.withTransactionAsync(async () => {
    let finalAccountId = t.accountId;

    // NUEVO: Si no es tarjeta y no tiene cuenta, usamos la cuenta por defecto
    if (!useCard && !finalAccountId && status === 'posted') {
      finalAccountId = await getOrCreateDefaultAccount(db);
    }

    // Escribimos la transacción (ahora con el accountId asegurado)
    await writeRow(db, 'transactions', txRow(id, { ...t, accountId: finalAccountId }, useCard ? t.cardId! : null, now));
    
    if (status !== 'posted') return;

    if (useCard) {
      const card = await db.getFirstAsync<{ balance: number }>('SELECT balance FROM debts WHERE id=?', [t.cardId!]);
      if (card) await patchRow(db, 'debts', t.cardId!, { balance: card.balance + Math.round(t.amount) });
    } else if (finalAccountId) {
      // Aquí aplicamos el movimiento a la cuenta por defecto o a la elegida
      await adjustAccount(db, finalAccountId, t.type === 'expense' ? -Math.round(t.amount) : Math.round(t.amount));
    }
  });
  return id;
}

// ... (imports y código anterior se mantienen igual) ...
// Busca donde termina createTransaction y pega esto justo debajo:

/**
 * Actualiza una transacción existente y ajusta los saldos.
 * Revierte el efecto de la transacción anterior y aplica el nuevo.
 */
export async function updateTransaction(id: string, t: NewTx): Promise<boolean> {
  const db = await getDb();
  if (t.amount <= 0) return false;
  let ok = true;
  
  await db.withTransactionAsync(async () => {
    const old = await db.getFirstAsync<{
      type: TxType; amount: number; account_id: string | null; debt_id: string | null; status: TxStatus; payment_method: PaymentMethod;
    }>('SELECT type, amount, account_id, debt_id, status, payment_method FROM transactions WHERE id=?', [id]);
    
    if (!old) { ok = false; return; }

    // Si pertenece a un plan de cuotas (préstamo o BNPL), no permitir editar aquí
    const debt = old.debt_id 
      ? await db.getFirstAsync<{ kind: string }>('SELECT kind FROM debts WHERE id=?', [old.debt_id]) 
      : null;
      
    if (debt && debt.kind !== 'credit_card') { ok = false; return; }

    // 1. REVERTIR EL EFECTO ANTERIOR (si estaba 'posted')
    if (old.status === 'posted') {
      if (old.debt_id) { // Era tarjeta a 1 pago
        const card = await db.getFirstAsync<{ balance: number }>('SELECT balance FROM debts WHERE id=?', [old.debt_id]);
        if (card) await patchRow(db, 'debts', old.debt_id, { balance: Math.max(0, card.balance - old.amount) });
      } else if (old.account_id) {
        await adjustAccount(db, old.account_id, old.type === 'expense' ? old.amount : -old.amount);
      }
    }

    // 2. PREPARAR NUEVOS DATOS
    const useCard = t.paymentMethod === 'credit' && !!t.cardId;
    let finalAccountId = t.accountId;
    if (!useCard && !finalAccountId) {
      finalAccountId = await getOrCreateDefaultAccount(db);
    }

    // 3. ACTUALIZAR LA FILA EN LA BD
    await patchRow(db, 'transactions', id, {
      type: t.type,
      amount: Math.round(t.amount),
      merchant: t.merchant,
      category_id: t.categoryId,
      account_id: finalAccountId,
      debt_id: useCard ? t.cardId! : null,
      payment_method: t.paymentMethod ?? 'unknown',
      occurred_at: t.occurredAt ?? Date.now(),
      updated_at: Date.now()
    });

    // 4. APLICAR EL NUEVO EFECTO
    if (useCard && t.cardId) {
      const card = await db.getFirstAsync<{ balance: number }>('SELECT balance FROM debts WHERE id=?', [t.cardId]);
      if (card) await patchRow(db, 'debts', t.cardId, { balance: card.balance + Math.round(t.amount) });
    } else if (finalAccountId) {
      await adjustAccount(db, finalAccountId, t.type === 'expense' ? -Math.round(t.amount) : Math.round(t.amount));
    }
  });

  return ok;
}

/** Compra a cuotas nueva (formulario manual): crea la transacción + el plan + el calendario. */
export async function createInstallmentPurchase(
  t: NewTx, plan: Omit<PlanParams, 'principal'>,
): Promise<{ txId: string; planId: string; monthlyPayment: number }> {
  const db = await getDb();
  const txId = uid();
  const now = Date.now();
  let out = { planId: '', monthlyPayment: 0 };
  await db.withTransactionAsync(async () => {
    const created = await insertPlan(db, { ...plan, principal: Math.round(t.amount) }, txId);
    out = { planId: created.id, monthlyPayment: created.monthlyPayment };
    await writeRow(db, 'transactions', txRow(txId, { ...t, status: 'posted' }, created.id, now));
  });
  return { txId, ...out };
}

/** Completa una compra detectada por notificación: "sí, fue a N cuotas". */
export async function resolvePendingWithPlan(txId: string, plan: Omit<PlanParams, 'principal'>): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const tx = await db.getFirstAsync<{ amount: number }>('SELECT amount FROM transactions WHERE id=?', [txId]);
    if (!tx) return;
    const created = await insertPlan(db, { ...plan, principal: tx.amount }, txId);
    await patchRow(db, 'transactions', txId, { debt_id: created.id, status: 'posted' });
  });
}

/** "Fue a 1 pago con la tarjeta": suma al saldo rotativo. */
export async function resolvePendingSinglePayment(txId: string, cardId: string): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const tx = await db.getFirstAsync<{ amount: number }>('SELECT amount FROM transactions WHERE id=?', [txId]);
    const card = await db.getFirstAsync<{ balance: number }>('SELECT balance FROM debts WHERE id=?', [cardId]);
    if (!tx || !card) return;
    await patchRow(db, 'debts', cardId, { balance: card.balance + tx.amount });
    await patchRow(db, 'transactions', txId, { debt_id: cardId, status: 'posted', payment_method: 'credit' });
  });
}

/** "No fue a crédito": se paga con una cuenta (débito). */
export async function resolvePendingWithAccount(txId: string, accountId: string): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const tx = await db.getFirstAsync<{ amount: number }>('SELECT amount FROM transactions WHERE id=?', [txId]);
    if (!tx) return;
    await adjustAccount(db, accountId, -tx.amount);
    await patchRow(db, 'transactions', txId, { account_id: accountId, status: 'posted', payment_method: 'debit' });
  });
}

/**
 * Elimina una transacción revirtiendo su efecto. Devuelve false si pertenece a un plan de cuotas
 * (en ese caso se elimina la deuda desde su pantalla, para no dejar el calendario huérfano).
 */
export async function deleteTransaction(id: string): Promise<boolean> {
  const db = await getDb();
  let ok = true;
  await db.withTransactionAsync(async () => {
    const tx = await db.getFirstAsync<{
      type: TxType; amount: number; account_id: string | null; debt_id: string | null; status: TxStatus; category_id: string | null;
    }>('SELECT type,amount,account_id,debt_id,status,category_id FROM transactions WHERE id=?', [id]);
    if (!tx) return;
    const debt = tx.debt_id
      ? await db.getFirstAsync<{ kind: string; balance: number }>('SELECT kind,balance FROM debts WHERE id=?', [tx.debt_id])
      : null;
    if (debt && debt.kind !== 'credit_card') { ok = false; return; }

    if (tx.status === 'posted') {
      if (debt) await patchRow(db, 'debts', tx.debt_id!, { balance: Math.max(0, debt.balance - tx.amount) });
      else if (tx.account_id) await adjustAccount(db, tx.account_id, tx.type === 'expense' ? tx.amount : -tx.amount);
    }
    await softDelete(db, 'transactions', id);
  });
  return ok;
}

// ───────────── Consultas ─────────────
const SELECT_TX = `
  SELECT t.id,t.type,t.amount,t.merchant,t.note,t.occurred_at,t.payment_method,t.status,
         t.category_id,c.name AS category_name,t.account_id,t.debt_id
    FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
   WHERE t.deleted_at IS NULL`;

export async function listTransactions(opts: { limit?: number; month?: string } = {}): Promise<TxRow[]> {
  const db = await getDb();
  const args: (string | number)[] = [];
  let sql = SELECT_TX + " AND t.status <> 'needs_installments'";
  if (opts.month) {
    const { start, end } = monthRange(opts.month);
    sql += ' AND t.occurred_at >= ? AND t.occurred_at < ?';
    args.push(start, end);
  }
  sql += ' ORDER BY t.occurred_at DESC';
  if (opts.limit) { sql += ' LIMIT ?'; args.push(opts.limit); }
  return db.getAllAsync<TxRow>(sql, args);
}

export async function listPending(): Promise<TxRow[]> {
  const db = await getDb();
  return db.getAllAsync<TxRow>(SELECT_TX + " AND t.status='needs_installments' ORDER BY t.occurred_at DESC");
}

export async function getTransaction(id: string): Promise<TxRow | null> {
  const db = await getDb();
  return db.getFirstAsync<TxRow>(SELECT_TX + ' AND t.id=?', [id]);
}

export interface MonthTotals { income: number; expense: number; debtPayments: number }

/** Ingresos/gastos del mes (solo 'posted'). Los pagos de deuda van aparte para no contar dos veces. */
export async function monthTotals(month: string): Promise<MonthTotals> {
  const db = await getDb();
  const { start, end } = monthRange(month);
  const rows = await db.getAllAsync<{ type: TxType; cat: string | null; s: number }>(
    `SELECT type, category_id AS cat, SUM(amount) AS s FROM transactions
      WHERE deleted_at IS NULL AND status='posted' AND occurred_at >= ? AND occurred_at < ? GROUP BY type, category_id`,
    [start, end],
  );
  const out: MonthTotals = { income: 0, expense: 0, debtPayments: 0 };
  for (const r of rows) {
    if (r.type === 'income') out.income += r.s;
    else if (r.cat === 'cat_deudas') out.debtPayments += r.s;
    else out.expense += r.s;
  }
  return out;
}

export interface CategorySpend { categoryId: string; name: string; total: number }

/** Gasto del mes por categoría de primer nivel (las subcategorías suman en su padre). */
export async function spendingByCategory(month: string): Promise<CategorySpend[]> {
  const db = await getDb();
  const { start, end } = monthRange(month);
  return db.getAllAsync<CategorySpend>(
    `SELECT COALESCE(p.id, c.id, 'cat_otros') AS categoryId,
            COALESCE(p.name, c.name, 'Otros') AS name,
            SUM(t.amount) AS total
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN categories p ON p.id = c.parent_id
      WHERE t.deleted_at IS NULL AND t.status='posted' AND t.type='expense'
        AND COALESCE(t.category_id,'') <> 'cat_deudas'
        AND t.occurred_at >= ? AND t.occurred_at < ?
      GROUP BY 1,2 ORDER BY total DESC`,
    [start, end],
  );
}

// ───────────── Categorías y reglas ─────────────
export interface Category { id: string; name: string; parent_id: string | null; kind: 'expense' | 'income' }

export async function listCategories(): Promise<Category[]> {
  const db = await getDb();
  return db.getAllAsync<Category>('SELECT id,name,parent_id,kind FROM categories WHERE deleted_at IS NULL ORDER BY parent_id IS NOT NULL, name');
}

export interface RuleRow extends CategoryRule { id: string }

export async function listRules(): Promise<RuleRow[]> {
  const db = await getDb();
  return db.getAllAsync<RuleRow>(
    'SELECT id, pattern, match_type AS matchType, category_id AS categoryId, priority FROM categorization_rules WHERE deleted_at IS NULL ORDER BY priority DESC',
  );
}

export async function addRule(pattern: string, categoryId: string): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.withTransactionAsync(() =>
    writeRow(db, 'categorization_rules', {
      id: uid(), pattern: pattern.trim(), match_type: 'contains', category_id: categoryId, priority: 10,
      created_at: now, updated_at: now, deleted_at: null,
    }),
  );
}

export async function deleteRule(id: string): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(() => softDelete(db, 'categorization_rules', id));
}

/** Sugiere categoría: reglas del usuario → palabras clave predefinidas. */
export async function suggestCategory(text: string): Promise<string | null> {
  return categorize(text, await listRules());
}

// ───────────── Presupuestos ─────────────
export interface BudgetLine { categoryId: string; name: string; amount: number; spent: number; threshold: number }

/** Presupuestos del mes con lo gastado. Un presupuesto con month=NULL aplica a todos los meses. */
export async function listBudgetLines(month: string): Promise<BudgetLine[]> {
  const db = await getDb();
  const budgets = await db.getAllAsync<{ category_id: string; name: string; amount: number; alert_threshold: number }>(
    `SELECT b.category_id, c.name, b.amount, b.alert_threshold FROM budgets b JOIN categories c ON c.id=b.category_id
      WHERE b.deleted_at IS NULL AND (b.month IS NULL OR b.month=?) ORDER BY c.name`, [month],
  );
  const spend = new Map((await spendingByCategory(month)).map((s) => [s.categoryId, s.total]));
  return budgets.map((b) => ({
    categoryId: b.category_id, name: b.name, amount: b.amount, spent: spend.get(b.category_id) ?? 0, threshold: b.alert_threshold,
  }));
}

/** Crea o actualiza el presupuesto mensual recurrente de una categoría (0 = quitarlo). */
export async function setBudget(categoryId: string, amount: number): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const existing = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM budgets WHERE category_id=? AND month IS NULL AND deleted_at IS NULL', [categoryId],
    );
    if (existing && amount <= 0) return softDelete(db, 'budgets', existing.id);
    if (existing) return patchRow(db, 'budgets', existing.id, { amount });
    if (amount <= 0) return;
    const now = Date.now();
    await writeRow(db, 'budgets', {
      id: uid(), category_id: categoryId, month: null, amount, alert_threshold: 0.8,
      created_at: now, updated_at: now, deleted_at: null,
    });
  });
}

export async function budgetAmounts(): Promise<Map<string, number>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ category_id: string; amount: number }>(
    'SELECT category_id, amount FROM budgets WHERE deleted_at IS NULL AND month IS NULL',
  );
  return new Map(rows.map((r) => [r.category_id, r.amount]));
}

export { addMonthKey, monthKey };
