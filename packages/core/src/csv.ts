import { parseCopAmount } from './notifications/parse';
import { dedupeHash } from './notifications/sanitize';

/**
 * Importación de extractos bancarios en CSV. Los bancos colombianos exportan con formatos
 * distintos (coma o punto y coma, fechas día/mes/año, montos con puntos de miles), así que
 * el parser detecta lo que puede y la app deja al usuario confirmar el mapeo de columnas.
 */

/** Lector CSV con comillas, BOM y detección de separador (, ; tabulador). */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch as keyof typeof counts]++;
  }
  const delim = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![0]) as string;

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

/** Fecha → epoch ms (mediodía local). Acepta AAAA-MM-DD, DD/MM/AAAA, DD-MM-AA… (día primero, como en Colombia). */
export function parseDate(s: string): number | null {
  const t = s.trim();
  let y: number, m: number, d: number;
  let x = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(t);
  if (x) { y = +x[1]!; m = +x[2]!; d = +x[3]!; }
  else if ((x = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(t))) {
    d = +x[1]!; m = +x[2]!; y = +x[3]!;
    if (y < 100) y += 2000;
  } else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d, 12, 0, 0);
  return date.getMonth() === m - 1 ? date.getTime() : null;
}

/** Monto con signo: "-1.234,56", "$ 50.000", "(50.000)", "50.000-" → número (pesos enteros). */
export function parseMoney(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const negative = /^-|-$|^\(.*\)$/.test(t.replace(/[$\s]/g, ''));
  const digits = t.replace(/[^\d.,]/g, '');
  if (!/\d/.test(digits)) return null;
  const v = parseCopAmount(digits);
  if (v === null) return null;
  return negative ? -v : v;
}

export interface ColumnMap {
  date: number;
  description: number;
  /** Columna única con signo (o todo positivo). */
  amount: number | null;
  /** Columnas separadas de débito/crédito (algunos bancos). */
  debit: number | null;
  credit: number | null;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Adivina columnas por el encabezado. Devuelve null si no encuentra fecha o descripción. */
export function guessColumns(header: string[]): ColumnMap | null {
  const h = header.map(norm);
  const find = (...keys: string[]) => h.findIndex((c) => keys.some((k) => c.includes(k)));
  const date = find('fecha', 'date');
  const description = find('descripcion', 'detalle', 'concepto', 'description', 'comercio', 'movimiento');
  if (date < 0 || description < 0) return null;
  const debit = find('debito', 'retiro', 'egreso', 'cargo');
  const credit = find('credito', 'deposito', 'ingreso', 'abono');
  const amount = find('valor', 'monto', 'importe', 'amount');
  return {
    date, description,
    amount: amount >= 0 ? amount : null,
    debit: debit >= 0 && credit >= 0 ? debit : null,
    credit: debit >= 0 && credit >= 0 ? credit : null,
  };
}

export interface ImportRow {
  occurredAt: number;
  description: string;
  amount: number;
  type: 'expense' | 'income';
  dedupe: string;
}

export interface MapResult { rows: ImportRow[]; skipped: number }

/**
 * Convierte filas en transacciones. Con una sola columna de monto: si hay algún negativo,
 * negativo = gasto y positivo = ingreso; si todo es positivo se asume que son gastos
 * (los extractos de tarjeta suelen venir así). `positiveIsIncome` permite forzarlo.
 */
export function mapRows(rows: string[][], map: ColumnMap, positiveIsIncome?: boolean): MapResult {
  const parsed: { at: number; desc: string; signed: number }[] = [];
  let skipped = 0;
  for (const r of rows) {
    const at = parseDate(r[map.date] ?? '');
    const desc = (r[map.description] ?? '').trim();
    let signed: number | null = null;
    if (map.debit !== null && map.credit !== null) {
      const d = parseMoney(r[map.debit] ?? '');
      const c = parseMoney(r[map.credit] ?? '');
      if (d) signed = -Math.abs(d);
      else if (c) signed = Math.abs(c);
    } else if (map.amount !== null) signed = parseMoney(r[map.amount] ?? '');
    if (at === null || signed === null || signed === 0) { skipped++; continue; }
    parsed.push({ at, desc, signed });
  }
  const anyNegative = parsed.some((p) => p.signed < 0);
  const posIncome = positiveIsIncome ?? anyNegative;
  return {
    skipped,
    rows: parsed.map((p) => {
      const income = p.signed > 0 && posIncome;
      const amount = Math.abs(p.signed);
      return {
        occurredAt: p.at, description: p.desc, amount, type: income ? 'income' : 'expense',
        dedupe: 'csv:' + dedupeHash(`${p.at}|${p.desc}|${amount}|${income}`),
      } satisfies ImportRow;
    }),
  };
}

/**
 * Escapa una celda para escribir CSV y neutraliza la INYECCIÓN DE FÓRMULAS: si el texto empieza
 * por = + - @ (o tabulador/retorno), Excel y Sheets lo ejecutarían como fórmula al abrir el archivo
 * (p. ej. un comercio llamado "=HYPERLINK(...)" que venga de una notificación). Se antepone una
 * comilla simple. Los números reales (montos) se escriben sin tocar.
 */
export function csvCell(v: string | number | null | undefined): string {
  if (typeof v === 'number') return String(v);
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
