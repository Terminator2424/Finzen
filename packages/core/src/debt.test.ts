import { describe, expect, it } from 'vitest';
import { addMonthKey, budgetStatus, monthRange } from './budget';
import { categorize } from './categorize';
import { compareExtraPayment, nextOccurrence, rankDebts, simulatePayoff, summarizeCard } from './debt';

describe('nextOccurrence', () => {
  it('hoy cuenta si coincide', () => expect(nextOccurrence('2026-10-15', 15)).toBe('2026-10-15'));
  it('pasa al mes siguiente si ya pasó', () => expect(nextOccurrence('2026-10-16', 15)).toBe('2026-11-15'));
  it('cruza de año', () => expect(nextOccurrence('2026-12-20', 5)).toBe('2027-01-05'));
  it('recorta a fin de mes', () => expect(nextOccurrence('2026-02-10', 31)).toBe('2026-02-28'));
});

describe('summarizeCard', () => {
  it('suma saldo rotativo + planes y calcula cupo disponible', () => {
    const s = summarizeCard({
      creditLimit: 2_000_000, revolvingBalance: 300_000, planBalances: [400_000, 100_000],
      cutDay: 10, dueDay: 25, monthlyRate: 0.02, today: '2026-10-13',
    });
    expect(s.used).toBe(800_000);
    expect(s.available).toBe(1_200_000);
    expect(s.utilization).toBeCloseTo(0.4);
    expect(s.nextCut).toBe('2026-11-10');
    expect(s.nextDue).toBe('2026-10-25');
    expect(s.estimatedMonthlyInterest).toBe(6_000);
  });

  it('el cupo disponible nunca es negativo', () => {
    const s = summarizeCard({
      creditLimit: 100, revolvingBalance: 500, planBalances: [], cutDay: null, dueDay: null, monthlyRate: 0, today: '2026-10-13',
    });
    expect(s.available).toBe(0);
    expect(s.nextCut).toBeNull();
  });
});

describe('simulatePayoff', () => {
  it('sin interés: saldo / cuota meses', () => {
    expect(simulatePayoff(100_000, 0, 25_000)).toEqual({ months: 4, totalInterest: 0, neverPaysOff: false });
  });

  it('detecta cuota que no cubre los intereses', () => {
    expect(simulatePayoff(1_000_000, 0.03, 20_000).neverPaysOff).toBe(true);
  });

  it('un abono extra ahorra meses e intereses', () => {
    const c = compareExtraPayment(1_000_000, 0.02, 100_000, 50_000, 'monthly');
    expect(c.monthsSaved).toBeGreaterThan(0);
    expect(c.interestSaved).toBeGreaterThan(0);
    expect(c.withExtra.months).toBeLessThan(c.base.months);
  });

  it('abono único también reduce el costo', () => {
    const c = compareExtraPayment(1_000_000, 0.02, 100_000, 200_000, 'oneTime');
    expect(c.interestSaved).toBeGreaterThan(0);
  });
});

describe('rankDebts', () => {
  const debts = [
    { id: 'a', balance: 500_000, monthlyRate: 0.01 },
    { id: 'b', balance: 2_000_000, monthlyRate: 0.03 },
    { id: 'c', balance: 100_000, monthlyRate: 0.02 },
    { id: 'z', balance: 0, monthlyRate: 0.09 },
  ];
  it('avalancha: mayor interés primero', () =>
    expect(rankDebts(debts, 'avalanche').map((d) => d.id)).toEqual(['b', 'c', 'a']));
  it('bola de nieve: menor saldo primero', () =>
    expect(rankDebts(debts, 'snowball').map((d) => d.id)).toEqual(['c', 'a', 'b']));
});

describe('categorize', () => {
  it('palabras clave predefinidas, con tildes y sin tildes', () => {
    expect(categorize('RAPPI COLOMBIA')).toBe('cat_comida_domicilio');
    expect(categorize('Droguería Cruz Verde')).toBe('cat_salud');
    expect(categorize('Uber *trip')).toBe('cat_transporte');
  });
  it('"ara" no coincide dentro de "para"', () => {
    expect(categorize('Pago para la fiesta')).toBeNull();
    expect(categorize('Tienda ARA')).toBe('cat_comida_mercado');
  });
  it('las reglas del usuario ganan a las predefinidas', () => {
    const rules = [{ pattern: 'rappi', matchType: 'contains' as const, categoryId: 'cat_otros', priority: 1 }];
    expect(categorize('Rappi', rules)).toBe('cat_otros');
  });
  it('regex inválida no rompe', () => {
    const rules = [{ pattern: '([', matchType: 'regex' as const, categoryId: 'cat_otros', priority: 1 }];
    expect(categorize('Netflix', rules)).toBe('cat_entretenimiento');
  });
  it('sin coincidencia → null', () => expect(categorize('xyz')).toBeNull());
});

describe('presupuesto y meses', () => {
  it('niveles ok / warn / over', () => {
    expect(budgetStatus(500, 1000).level).toBe('ok');
    expect(budgetStatus(800, 1000).level).toBe('warn');
    expect(budgetStatus(1001, 1000).level).toBe('over');
    expect(budgetStatus(10, 0).level).toBe('over');
  });
  it('monthRange y addMonthKey', () => {
    const r = monthRange('2026-10');
    expect(new Date(r.start).getMonth()).toBe(9);
    expect(addMonthKey('2026-01', -1)).toBe('2025-12');
    expect(addMonthKey('2026-11', 3)).toBe('2027-02');
  });
});
