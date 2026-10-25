/**
 * Cálculo de compras a cuotas (Addi, Sistecrédito, tarjetas de crédito...).
 *
 * Método francés (cuota fija): lo usan casi todos los créditos de consumo en Colombia.
 * Todo es matemática determinista — NO se usa IA para esto, porque un LLM puede
 * equivocarse en aritmética y aquí un error son pesos reales.
 *
 * Tres formas de llegar a la tasa, de más a menos fácil para el usuario:
 *  1. Escribe la cuota que le muestra Addi/Sistecrédito  → `solveMonthlyRate` deduce la tasa.
 *  2. Escribe la tasa efectiva anual (E.A.)              → `monthlyRateFromEA`.
 *  3. Compra "sin intereses" (tasa 0) con o sin cargos fijos por cuota.
 */

/** Tasa mensual equivalente a una tasa efectiva anual. EA 0.30 (30 %) → ≈ 0.02210. */
export function monthlyRateFromEA(ea: number): number {
  if (ea <= -1) throw new RangeError('La tasa E.A. debe ser > -100 %');
  return Math.pow(1 + ea, 1 / 12) - 1;
}

/** Inverso de `monthlyRateFromEA`. */
export function eaFromMonthlyRate(monthlyRate: number): number {
  return Math.pow(1 + monthlyRate, 12) - 1;
}

/** Cuota fija (solo capital + interés) de un préstamo a `n` cuotas con tasa mensual `r`. */
export function annuityPayment(principal: number, n: number, r: number): number {
  if (n <= 0) throw new RangeError('El número de cuotas debe ser >= 1');
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

export interface ScheduleInput {
  /** Monto financiado en pesos enteros. */
  principal: number;
  /** Número de cuotas. */
  installments: number;
  /** Tasa mensual como proporción (0.02 = 2 %). */
  monthlyRate: number;
  /** Fecha de la primera cuota, 'YYYY-MM-DD'. Las demás caen el mismo día de cada mes. */
  firstDueDate: string;
  /** Cargo fijo que se suma a cada cuota (seguro, aval, manejo). Por defecto 0. */
  feePerInstallment?: number;
}

export interface InstallmentRow {
  number: number;
  dueDate: string;
  principal: number;
  interest: number;
  fee: number;
  /** principal + interest + fee: lo que realmente se paga ese mes. */
  total: number;
  /** Saldo de capital después de pagar esta cuota. */
  balanceAfter: number;
}

/**
 * Tabla de amortización. Los valores se redondean al peso; la última cuota
 * absorbe la diferencia de redondeo para que el saldo termine exactamente en 0.
 */
export function buildSchedule(input: ScheduleInput): InstallmentRow[] {
  const { principal, installments: n, monthlyRate: r, firstDueDate } = input;
  const fee = Math.round(input.feePerInstallment ?? 0);
  if (!Number.isInteger(n) || n < 1 || n > 600) throw new RangeError('Las cuotas deben ser un entero entre 1 y 600');
  if (principal <= 0) throw new RangeError('El monto financiado debe ser > 0');
  if (r < 0) throw new RangeError('La tasa no puede ser negativa');

  const basePayment = Math.round(annuityPayment(principal, n, r));
  const rows: InstallmentRow[] = [];
  let balance = Math.round(principal);

  for (let k = 1; k <= n; k++) {
    const interest = Math.round(balance * r);
    const isLast = k === n;
    const capital = isLast ? balance : Math.min(balance, basePayment - interest);
    balance -= capital;
    rows.push({
      number: k,
      dueDate: addMonthsClamped(firstDueDate, k - 1),
      principal: capital,
      interest,
      fee,
      total: capital + interest + fee,
      balanceAfter: balance,
    });
  }
  return rows;
}

/**
 * Deduce la tasa mensual a partir de la cuota que muestra la app del prestamista.
 * `payment` es la cuota SIN cargos fijos (si Addi muestra un total con seguro,
 * réstale el seguro antes). Búsqueda por bisección: robusta y sin dependencias.
 * Devuelve 0 si la cuota × n no supera el capital (compra sin intereses).
 */
export function solveMonthlyRate(principal: number, installments: number, payment: number): number {
  if (payment * installments <= principal + installments / 2) return 0; // tolerancia de redondeo
  let lo = 0;
  let hi = 1; // 100 % mensual: techo absurdo, pero seguro
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (annuityPayment(principal, installments, mid) < payment) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface ScheduleSummary {
  totalPaid: number;
  totalInterest: number;
  totalFees: number;
  /** Cuánto pagas de más sobre lo que costaba (intereses + cargos). */
  extraCost: number;
  /** Primera cuota (suele ser igual a todas salvo la última). */
  firstPayment: number;
}

export function summarizeSchedule(rows: InstallmentRow[]): ScheduleSummary {
  const totalPaid = rows.reduce((s, r) => s + r.total, 0);
  const totalInterest = rows.reduce((s, r) => s + r.interest, 0);
  const totalFees = rows.reduce((s, r) => s + r.fee, 0);
  return {
    totalPaid,
    totalInterest,
    totalFees,
    extraCost: totalInterest + totalFees,
    firstPayment: rows[0]?.total ?? 0,
  };
}

// ───────────────────────── Fechas ─────────────────────────

/** Días del mes (month: 1-12). */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Suma meses a una fecha 'YYYY-MM-DD' manteniendo el día; si el mes destino es más
 * corto se usa su último día (31 ene + 1 mes = 28/29 feb). Siempre parte de la fecha
 * ORIGINAL, así 31 ene → 28 feb → 31 mar (no se "arrastra" el recorte).
 */
export function addMonthsClamped(date: string, months: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new RangeError(`Fecha inválida: ${date}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const index = y * 12 + (mo - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const day = Math.min(d, daysInMonth(year, month));
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ───────────────────────── Plan de cuotas según lo que sabe el usuario ─────────────────────────

/** Cómo el usuario describe el costo de la compra a cuotas. */
export type RateMode =
  /** "La cuota que me muestra la app es $X": se deduce la tasa. */
  | { kind: 'payment'; payment: number }
  /** "La tasa es X % efectiva anual". */
  | { kind: 'ea'; eaPct: number }
  /** Sin intereses, con cargo fijo opcional por cuota. */
  | { kind: 'zero'; feePerInstallment: number };

export interface PlanInput {
  principal: number;
  installments: number;
  firstDueDate: string;
  mode: RateMode;
}

export interface PlanResult {
  monthlyRate: number;
  feePerInstallment: number;
  schedule: InstallmentRow[];
  summary: ScheduleSummary;
}

/** Une todo: tasa (deducida o dada) → tabla de cuotas → resumen de costo. */
export function planFromMode(input: PlanInput): PlanResult {
  const { principal, installments, firstDueDate, mode } = input;
  let monthlyRate = 0;
  let fee = 0;
  if (mode.kind === 'payment') monthlyRate = solveMonthlyRate(principal, installments, mode.payment);
  else if (mode.kind === 'ea') monthlyRate = mode.eaPct > 0 ? monthlyRateFromEA(mode.eaPct / 100) : 0;
  else fee = Math.max(0, Math.round(mode.feePerInstallment));

  const schedule = buildSchedule({ principal, installments, monthlyRate, firstDueDate, feePerInstallment: fee });
  return { monthlyRate, feePerInstallment: fee, schedule, summary: summarizeSchedule(schedule) };
}
