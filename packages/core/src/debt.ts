/**
 * Lógica de tarjetas de crédito y estrategias de pago de deudas.
 * Matemática determinista (nada de IA con dinero).
 *
 * Modelo de tarjeta en FinZen:
 *  - `balance` de la tarjeta = saldo rotativo (compras a 1 pago que aún no pagas).
 *  - Cada compra diferida a N cuotas es un "plan" (deuda hija con `parent_debt_id`).
 *  - Cupo usado = saldo rotativo + saldos de todos los planes.
 */

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Fecha 'YYYY-MM-DD' de hoy según el reloj del dispositivo (hora local). */
export function todayString(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Próxima fecha (>= hoy) cuyo día del mes es `day`. Si el mes es más corto se usa su último día.
 * Sirve para "próximo corte" y "próximo pago" de una tarjeta.
 */
export function nextOccurrence(today: string, day: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!m) throw new RangeError(`Fecha inválida: ${today}`);
  let y = Number(m[1]);
  let mo = Number(m[2]);
  const candidate = (yy: number, mm: number) => `${pad(yy, 4)}-${pad(mm)}-${pad(Math.min(day, daysIn(yy, mm)))}`;
  let c = candidate(y, mo);
  if (c < today) {
    mo += 1;
    if (mo > 12) { mo = 1; y += 1; }
    c = candidate(y, mo);
  }
  return c;
}

export interface CardInput {
  creditLimit: number;
  revolvingBalance: number;
  planBalances: number[];
  cutDay: number | null;
  dueDay: number | null;
  /** Tasa mensual de la tarjeta (proporción). */
  monthlyRate: number;
  today: string;
}

export interface CardSummary {
  used: number;
  available: number;
  /** 0..1 (puede pasar de 1 si te excedes del cupo). */
  utilization: number;
  nextCut: string | null;
  nextDue: string | null;
  /** Interés aproximado de un mes si NO pagas el saldo rotativo completo. */
  estimatedMonthlyInterest: number;
}

export function summarizeCard(c: CardInput): CardSummary {
  const used = c.revolvingBalance + c.planBalances.reduce((s, b) => s + b, 0);
  return {
    used,
    available: Math.max(0, c.creditLimit - used),
    utilization: c.creditLimit > 0 ? used / c.creditLimit : 0,
    nextCut: c.cutDay ? nextOccurrence(c.today, c.cutDay) : null,
    nextDue: c.dueDay ? nextOccurrence(c.today, c.dueDay) : null,
    estimatedMonthlyInterest: Math.round(c.revolvingBalance * c.monthlyRate),
  };
}

// ───────────────────────── Simulador de pago ─────────────────────────

export interface PayoffResult {
  months: number;
  totalInterest: number;
  /** true si la cuota no cubre ni los intereses: la deuda crece. */
  neverPaysOff: boolean;
}

/**
 * Meses e intereses para saldar `balance` pagando `monthlyPayment` al mes con tasa mensual `r`.
 * `oneTimeExtra` se abona hoy; `extraMonthly` se suma a cada cuota.
 */
export function simulatePayoff(
  balance: number, r: number, monthlyPayment: number, extraMonthly = 0, oneTimeExtra = 0,
): PayoffResult {
  let b = Math.max(0, balance - oneTimeExtra);
  const pay = monthlyPayment + extraMonthly;
  let months = 0;
  let interest = 0;
  while (b > 0.5 && months < 1200) {
    const i = b * r;
    if (pay <= i) return { months, totalInterest: Math.round(interest), neverPaysOff: true };
    interest += i;
    b = b + i - pay;
    months++;
  }
  return { months, totalInterest: Math.round(interest), neverPaysOff: false };
}

export interface ExtraPaymentComparison {
  base: PayoffResult;
  withExtra: PayoffResult;
  monthsSaved: number;
  interestSaved: number;
}

/** "¿Qué pasa si pago $50.000 extra?" — mensual o una sola vez. */
export function compareExtraPayment(
  balance: number, r: number, monthlyPayment: number, extra: number, mode: 'monthly' | 'oneTime',
): ExtraPaymentComparison {
  const base = simulatePayoff(balance, r, monthlyPayment);
  const withExtra =
    mode === 'monthly'
      ? simulatePayoff(balance, r, monthlyPayment, extra, 0)
      : simulatePayoff(balance, r, monthlyPayment, 0, extra);
  return {
    base,
    withExtra,
    monthsSaved: base.neverPaysOff ? 0 : base.months - withExtra.months,
    interestSaved: base.neverPaysOff ? 0 : base.totalInterest - withExtra.totalInterest,
  };
}

export interface RankableDebt { id: string; balance: number; monthlyRate: number }
export type PayoffMethod = 'avalanche' | 'snowball';

/**
 * Orden recomendado para pagar extra.
 *  - avalancha: primero la de mayor interés (ahorra más dinero)
 *  - bola de nieve: primero la de menor saldo (motiva: cierras deudas rápido)
 */
export function rankDebts(debts: RankableDebt[], method: PayoffMethod): RankableDebt[] {
  const list = debts.filter((d) => d.balance > 0);
  return list.sort((a, b) =>
    method === 'avalanche'
      ? b.monthlyRate - a.monthlyRate || a.balance - b.balance
      : a.balance - b.balance || b.monthlyRate - a.monthlyRate,
  );
}
