import { mentionsPerson } from '@finzen/core';
import { getDb } from './db';
import { getSetting, patchRow, setSetting, uid, type Db } from './repo';

/**
 * Cuentas por cobrar: lo que otras personas te deben. Solo local: no pasa por la cola de sincronización.
 * No toca saldos de cuentas: el dinero ya entra o sale por las notificaciones o los movimientos normales.
 * Suma al patrimonio como activo mientras no te paguen (ver getNetWorth en repo.ts).
 */
export interface Receivable {
  id: string;
  debtor: string;
  amount: number;
  paid: number;
  due_date: string | null;
  note: string | null;
  created_at: number;
  updated_at: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const dateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const inDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return dateStr(d); };

/** Días desde hoy hasta la fecha (negativo = ya venció). */
export function daysUntil(due: string, from: Date = new Date()): number {
  const [y, m, d] = due.split('-').map(Number);
  const a = Date.UTC(y!, m! - 1, d!);
  const b = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  return Math.round((a - b) / 86_400_000);
}

export function validDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
}

/** Pendientes primero (por fecha de pago, las que no tienen fecha al final) y luego las ya pagadas. */
export async function listReceivables(): Promise<Receivable[]> {
  const db = await getDb();
  return db.getAllAsync<Receivable>(
    `SELECT id, debtor, amount, paid, due_date, note, created_at, updated_at FROM receivables
      WHERE deleted_at IS NULL
      ORDER BY (amount <= paid), due_date IS NULL, due_date, created_at DESC`,
  );
}

export async function addReceivable(i: { debtor: string; amount: number; dueDate: string | null; note: string | null }): Promise<string> {
  const debtor = i.debtor.trim().slice(0, 60);
  const amount = Math.round(i.amount);
  if (!debtor) throw new Error('Escribe quién te debe');
  if (!(amount > 0)) throw new Error('El monto debe ser mayor a cero');
  if (i.dueDate && !validDate(i.dueDate)) throw new Error('La fecha debe ser AAAA-MM-DD, por ejemplo 2026-12-15');
  const db = await getDb();
  const id = uid();
  const now = Date.now();
  await db.runAsync(
    'INSERT INTO receivables (id,debtor,amount,paid,due_date,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
    [id, debtor, amount, 0, i.dueDate || null, i.note?.trim().slice(0, 200) || null, now, now],
  );
  return id;
}

/** Aplica un pago dentro de una transacción ya abierta. Nunca pasa del saldo. */
async function payInTx(db: Db, id: string, amount?: number): Promise<number> {
  const r = await db.getFirstAsync<{ amount: number; paid: number }>(
    'SELECT amount, paid FROM receivables WHERE id=? AND deleted_at IS NULL', [id],
  );
  if (!r) throw new Error('Ese registro ya no existe');
  const left = r.amount - r.paid;
  if (left <= 0) throw new Error('Ya está pagado');
  const applied = Math.min(amount === undefined ? left : Math.round(amount), left);
  if (!(applied > 0)) throw new Error('El monto debe ser mayor a cero');
  const now = Date.now();
  await db.runAsync('UPDATE receivables SET paid = paid + ?, updated_at = ? WHERE id = ?', [applied, now, id]);
  await db.runAsync('INSERT INTO receivable_payments (id,receivable_id,amount,paid_at) VALUES (?,?,?,?)', [uid(), id, applied, now]);
  return applied;
}

/** Registra un pago (sin monto = lo que falte). Devuelve lo que se aplicó. */
export async function registerReceivablePayment(id: string, amount?: number): Promise<number> {
  const db = await getDb();
  let applied = 0;
  await db.withTransactionAsync(async () => { applied = await payInTx(db, id, amount); });
  return applied;
}

export async function deleteReceivable(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE receivables SET deleted_at = ?, updated_at = ? WHERE id = ?', [Date.now(), Date.now(), id]);
}

export function summarizeReceivables(list: Receivable[]): { total: number; people: number; overdue: number } {
  const open = list.filter((r) => r.amount > r.paid);
  return {
    total: open.reduce((s, r) => s + (r.amount - r.paid), 0),
    people: new Set(open.map((r) => r.debtor.trim().toLowerCase())).size,
    overdue: open.filter((r) => r.due_date !== null && daysUntil(r.due_date) < 0).length,
  };
}

// ───────────── Pagos detectados ─────────────
export interface PaymentSuggestion { txId: string; debtorId: string; debtor: string; amount: number; at: number; left: number }
const DISMISSED_KEY = 'receivable_dismissed';
const SUGGEST_DAYS = 7; // la bitácora de notificaciones se poda a los 7 días

async function dismissedIds(): Promise<string[]> {
  try {
    const v = JSON.parse((await getSetting(DISMISSED_KEY)) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

export async function dismissSuggestion(txId: string): Promise<void> {
  const ids = await dismissedIds();
  if (!ids.includes(txId)) ids.push(txId);
  await setSetting(DISMISSED_KEY, JSON.stringify(ids.slice(-100)), 'device');
}

/**
 * Ingresos leídos de notificaciones (últimos 21 días) cuyo texto nombra a alguien de la lista y no superan
 * lo que debe. Solo se propone si coincide UNA sola deuda; con dudas no se adivina.
 */
export async function findPaymentSuggestions(): Promise<PaymentSuggestion[]> {
  const db = await getDb();
  const open = (await listReceivables()).filter((r) => r.amount > r.paid);
  if (open.length === 0) return [];
  const txs = await db.getAllAsync<{ id: string; amount: number; occurred_at: number; text: string | null }>(
    `SELECT t.id, t.amount, t.occurred_at, MAX(l.masked_text) AS text
       FROM transactions t JOIN notifications_log l ON l.transaction_id = t.id
      WHERE t.deleted_at IS NULL AND t.type='income' AND t.source='notification' AND t.status='posted'
        AND COALESCE(t.category_id,'') NOT IN ('cat_transferencia','cat_transferencia_in','cat_cobro')
        AND t.occurred_at >= ?
      GROUP BY t.id ORDER BY t.occurred_at DESC`,
    [Date.now() - SUGGEST_DAYS * 86_400_000],
  );
  const skip = new Set(await dismissedIds());
  const out: PaymentSuggestion[] = [];
  for (const t of txs) {
    if (skip.has(t.id) || !t.text) continue;
    const text = t.text;
    const hits = open.filter((r) => mentionsPerson(text, r.debtor) && t.amount <= r.amount - r.paid);
    if (hits.length !== 1) continue;
    const h = hits[0]!;
    out.push({ txId: t.id, debtorId: h.id, debtor: h.debtor, amount: t.amount, at: t.occurred_at, left: h.amount - h.paid });
  }
  return out;
}

/** Descuenta el cobro y deja ese ingreso como "Cobro de deuda" (no cuenta como ingreso del mes). */
export async function applyPaymentSuggestion(s: PaymentSuggestion): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await payInTx(db, s.debtorId, s.amount);
    await patchRow(db, 'transactions', s.txId, {
      category_id: 'cat_cobro', merchant: `Pago de ${s.debtor}`, note: `Cobro registrado en Me deben · ${s.debtor}`,
    });
  });
}