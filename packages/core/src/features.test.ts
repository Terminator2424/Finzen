import { describe, expect, it } from 'vitest';
import { buildAiContext } from './ai';
import { guessColumns, mapRows, parseCsv, parseDate, parseMoney, csvCell } from './csv';
import { parseReceiptText } from './receipt';
import { parseSpokenExpense } from './voice';

describe('CSV', () => {
  it('detecta ; y comillas', () => {
    expect(parseCsv('Fecha;Descripción;Valor\n01/10/2026;"Rappi; Colombia";-50.000')).toEqual([
      ['Fecha', 'Descripción', 'Valor'], ['01/10/2026', 'Rappi; Colombia', '-50.000'],
    ]);
  });
  it('maneja BOM, comillas escapadas y CRLF', () => {
    expect(parseCsv('﻿a,b\r\n"x ""y""",2\r\n')).toEqual([['a', 'b'], ['x "y"', '2']]);
  });
  it('fechas día primero', () => {
    const d = new Date(parseDate('05/10/2026')!);
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 10, 5]);
    expect(parseDate('2026-10-05')).not.toBeNull();
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('hola')).toBeNull();
  });
  it('montos con signo', () => {
    expect(parseMoney('-$ 1.234.567')).toBe(-1_234_567);
    expect(parseMoney('(50.000)')).toBe(-50_000);
    expect(parseMoney('50.000-')).toBe(-50_000);
    expect(parseMoney('$20.500,00')).toBe(20_500);
    expect(parseMoney('abc')).toBeNull();
  });
  it('mapea columna única con signo', () => {
    const rows = parseCsv('Fecha,Descripcion,Valor\n01/10/2026,Rappi,-50000\n02/10/2026,Salario,2000000\nbasura,x,y');
    const map = guessColumns(rows[0]!)!;
    const r = mapRows(rows.slice(1), map);
    expect(r.skipped).toBe(1);
    expect(r.rows.map((x) => [x.type, x.amount])).toEqual([['expense', 50_000], ['income', 2_000_000]]);
  });
  it('todo positivo = gastos; débito/crédito separados', () => {
    const a = mapRows([['01/10/2026', 'Tienda', '30.000']], { date: 0, description: 1, amount: 2, debit: null, credit: null });
    expect(a.rows[0]!.type).toBe('expense');
    const b = mapRows(
      [['01/10/2026', 'Retiro', '20.000', ''], ['02/10/2026', 'Abono', '', '90.000']],
      { date: 0, description: 1, amount: null, debit: 2, credit: 3 },
    );
    expect(b.rows.map((x) => x.type)).toEqual(['expense', 'income']);
  });
  it('el mismo extracto produce los mismos hashes (no se duplica al reimportar)', () => {
    const m = { date: 0, description: 1, amount: 2, debit: null, credit: null };
    const x = mapRows([['01/10/2026', 'Tienda', '30.000']], m).rows[0]!.dedupe;
    expect(mapRows([['01/10/2026', 'Tienda', '30.000']], m).rows[0]!.dedupe).toBe(x);
  });
  it('escapa celdas al exportar', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('di "hola"')).toBe('"di ""hola"""');
    expect(csvCell(null)).toBe('');
  });
  it('neutraliza inyección de fórmulas pero no toca los montos', () => {
    expect(csvCell('=HYPERLINK("http://x","clic")')).toBe(`"'=HYPERLINK(""http://x"",""clic"")"`);
    expect(csvCell('+57 300')).toBe("'+57 300");
    expect(csvCell('-cmd|calc')).toBe("'-cmd|calc");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell(-50000)).toBe('-50000');
    expect(csvCell('Rappi')).toBe('Rappi');
  });
});

describe('recibos (OCR)', () => {
  const text = `ALKOSTO S.A.
NIT 860.000.000-1
Cra 30 # 10-20
Fecha: 05/10/2026
Producto A   $ 20.000
SUBTOTAL     $ 90.000
IVA          $ 17.100
TOTAL        $ 107.100`;
  it('extrae total, comercio y fecha', () => {
    const r = parseReceiptText(text);
    expect(r.amount).toBe(107_100);
    expect(r.merchant).toBe('ALKOSTO S.A.');
    expect(new Date(r.date!).getDate()).toBe(5);
  });
  it('sin la palabra total usa el monto mayor', () => {
    expect(parseReceiptText('Tienda X\nCafé 4.500\nPan 3.200\nPago 7.700').amount).toBe(7_700);
  });
  it('texto vacío no rompe', () => {
    expect(parseReceiptText('')).toEqual({ amount: null, merchant: null, date: null });
  });
});

describe('voz', () => {
  it.each([
    ['gasté veinte mil pesos en almuerzo', 'expense', 20_000, 'almuerzo'],
    ['pagué 50 mil de taxi', 'expense', 50_000, 'taxi'],
    ['compré mercado por ciento veinte mil pesos', 'expense', 120_000, 'mercado'],
    ['me pagaron dos millones quinientos mil de salario', 'income', 2_500_000, 'salario'],
    ['gasté cien mil en Rappi', 'expense', 100_000, 'rappi'],
    ['almuerzo 18.500', 'expense', 18_500, 'almuerzo'],
    ['gasté treinta y cinco mil en gasolina', 'expense', 35_000, 'gasolina'],
  ])('"%s"', (speech, type, amount, merchant) => {
    expect(parseSpokenExpense(speech)).toEqual({ type, amount, merchant });
  });
  it('sin número → amount null', () => {
    expect(parseSpokenExpense('hola cómo estás').amount).toBeNull();
  });
});

describe('contexto de IA', () => {
  it('no contiene nombres y etiqueta las deudas con letras', () => {
    const ctx = buildAiContext({
      month: '2026-10', assets: 1_000_000, liabilities: 600_000, income: 2_000_000, expense: 900_000, debtPayments: 200_000,
      byCategory: [{ name: 'Comida', total: 400_000 }],
      budgets: [{ name: 'Comida', amount: 500_000, spent: 400_000 }],
      debts: [
        { kind: 'credit_card', balance: 300_000, monthlyRatePct: 2.1, monthlyPayment: null, utilizationPct: 15 },
        { kind: 'credit_card', balance: 100_000, monthlyRatePct: 1.9, monthlyPayment: null },
        { kind: 'bnpl', balance: 200_000, monthlyRatePct: 0, monthlyPayment: 50_000 },
      ],
    });
    expect(ctx).toContain('Tarjeta de crédito A');
    expect(ctx).toContain('Tarjeta de crédito B');
    expect(ctx).toContain('Compra a cuotas A');
    expect(ctx).toContain('Patrimonio neto: $400.000');
    expect(ctx).not.toMatch(/bnub|bancolombia|nequi|addi/i);
  });
});
