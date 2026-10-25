export type BudgetLevel = 'ok' | 'warn' | 'over';

export interface BudgetStatus {
  /** 0..n (1 = 100 %). */
  ratio: number;
  remaining: number;
  level: BudgetLevel;
}

/** Estado de un presupuesto. `warn` desde el umbral (80 % por defecto), `over` al pasar el 100 %. */
export function budgetStatus(spent: number, amount: number, threshold = 0.8): BudgetStatus {
  const ratio = amount > 0 ? spent / amount : spent > 0 ? Infinity : 0;
  return {
    ratio,
    remaining: amount - spent,
    level: ratio > 1 ? 'over' : ratio >= threshold ? 'warn' : 'ok',
  };
}

/** Inicio y fin (epoch ms, hora local) de un mes 'YYYY-MM'. */
export function monthRange(month: string): { start: number; end: number } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return { start: new Date(y, m - 1, 1).getTime(), end: new Date(y, m, 1).getTime() };
}

export function monthKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Mes anterior/siguiente: addMonthKey('2026-01', -1) → '2025-12'. */
export function addMonthKey(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}
