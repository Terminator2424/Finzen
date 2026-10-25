import { describe, expect, it } from 'vitest';
import {
  addMonthsClamped,
  buildSchedule,
  eaFromMonthlyRate,
  monthlyRateFromEA,
  solveMonthlyRate,
  summarizeSchedule,
} from './credit';

describe('tasas', () => {
  it('convierte E.A. ↔ mensual', () => {
    const m = monthlyRateFromEA(0.3);
    expect(m).toBeCloseTo(0.0221, 4);
    expect(eaFromMonthlyRate(m)).toBeCloseTo(0.3, 10);
  });
});

describe('buildSchedule', () => {
  it('cuota fija con interés: 300.000 a 6 cuotas al 2 % mensual', () => {
    const rows = buildSchedule({ principal: 300_000, installments: 6, monthlyRate: 0.02, firstDueDate: '2026-11-15' });
    expect(rows).toHaveLength(6);
    expect(rows[0]!.total).toBeGreaterThan(53_500);
    expect(rows[0]!.total).toBeLessThan(53_600);
    expect(rows[0]!.interest).toBe(6_000); // 2 % de 300.000
    expect(rows.reduce((s, r) => s + r.principal, 0)).toBe(300_000); // el capital cuadra al peso
    expect(rows.at(-1)!.balanceAfter).toBe(0);
  });

  it('sin intereses reparte el capital en partes iguales (± redondeo)', () => {
    const rows = buildSchedule({ principal: 100_000, installments: 3, monthlyRate: 0, firstDueDate: '2026-11-01' });
    expect(rows.map((r) => r.interest)).toEqual([0, 0, 0]);
    expect(rows.reduce((s, r) => s + r.total, 0)).toBe(100_000);
    expect(rows.at(-1)!.balanceAfter).toBe(0);
  });

  it('suma el cargo fijo por cuota al total', () => {
    const rows = buildSchedule({
      principal: 120_000, installments: 4, monthlyRate: 0, firstDueDate: '2026-11-01', feePerInstallment: 2_500,
    });
    expect(rows.every((r) => r.fee === 2_500)).toBe(true);
    const s = summarizeSchedule(rows);
    expect(s.totalFees).toBe(10_000);
    expect(s.totalPaid).toBe(130_000);
    expect(s.extraCost).toBe(10_000);
  });

  it('una sola cuota funciona', () => {
    const rows = buildSchedule({ principal: 50_000, installments: 1, monthlyRate: 0.02, firstDueDate: '2026-11-01' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.total).toBe(51_000);
  });

  it('rechaza entradas inválidas', () => {
    const base = { principal: 1000, installments: 3, monthlyRate: 0.01, firstDueDate: '2026-11-01' };
    expect(() => buildSchedule({ ...base, installments: 0 })).toThrow();
    expect(() => buildSchedule({ ...base, principal: 0 })).toThrow();
    expect(() => buildSchedule({ ...base, monthlyRate: -0.1 })).toThrow();
  });
});

describe('solveMonthlyRate (deducir tasa desde la cuota que muestra la app)', () => {
  it('recupera la tasa usada para generar la cuota', () => {
    const rows = buildSchedule({ principal: 300_000, installments: 6, monthlyRate: 0.025, firstDueDate: '2026-11-15' });
    const rate = solveMonthlyRate(300_000, 6, rows[0]!.total);
    expect(rate).toBeCloseTo(0.025, 4);
  });

  it('devuelve 0 cuando cuota × n ≈ capital (sin intereses)', () => {
    expect(solveMonthlyRate(90_000, 3, 30_000)).toBe(0);
  });
});

describe('addMonthsClamped', () => {
  it('conserva el día y recorta a fin de mes sin arrastrar el recorte', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2026-01-31', 2)).toBe('2026-03-31');
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29'); // bisiesto
  });

  it('cruza años', () => {
    expect(addMonthsClamped('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonthsClamped('2026-12-10', 12)).toBe('2027-12-10');
  });
});

import { planFromMode } from './credit';

describe('planFromMode', () => {
  it('modo cuota: deduce la tasa y reproduce la cuota dada', () => {
    const p = planFromMode({ principal: 300_000, installments: 6, firstDueDate: '2026-11-15', mode: { kind: 'payment', payment: 53_558 } });
    expect(p.monthlyRate).toBeGreaterThan(0.019);
    expect(p.monthlyRate).toBeLessThan(0.021);
    expect(Math.abs(p.schedule[0]!.total - 53_558)).toBeLessThanOrEqual(2);
  });
  it('modo sin intereses con cargo fijo', () => {
    const p = planFromMode({ principal: 100_000, installments: 4, firstDueDate: '2026-11-01', mode: { kind: 'zero', feePerInstallment: 1_000 } });
    expect(p.monthlyRate).toBe(0);
    expect(p.summary.totalPaid).toBe(104_000);
  });
  it('modo E.A.', () => {
    const p = planFromMode({ principal: 1_000_000, installments: 12, firstDueDate: '2026-11-01', mode: { kind: 'ea', eaPct: 30 } });
    expect(p.summary.totalInterest).toBeGreaterThan(100_000);
    expect(p.schedule.at(-1)!.balanceAfter).toBe(0);
  });
});
