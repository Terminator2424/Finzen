import { parseCopAmount } from './notifications/parse';
import { normalizeText } from './categorize';

/**
 * Dictado por voz: "gasté veinte mil pesos en almuerzo" → { gasto, 20000, "almuerzo" }.
 * Entiende cifras ("50 mil", "50.000") y números en palabras ("dos millones quinientos mil").
 */
export interface SpokenTx {
  type: 'expense' | 'income';
  amount: number | null;
  merchant: string | null;
}

const UNITS: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17,
  dieciocho: 18, diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22,
  veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
const TENS: Record<string, number> = {
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
};
const HUNDREDS: Record<string, number> = {
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300,
  cuatrocientos: 400, cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600,
  setecientos: 700, setecientas: 700, ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900,
};

const isNumToken = (t: string) =>
  t in UNITS || t in TENS || t in HUNDREDS || t === 'y' || t === 'mil' || t === 'millon' || t === 'millones' ||
  /^\d[\d.,]*$/.test(t);

/** Suma una secuencia de tokens numéricos ya normalizados. */
function sumTokens(tokens: string[]): number | null {
  let total = 0;
  let current = 0;
  let any = false;
  for (const t of tokens) {
    if (t === 'y') continue;
    any = true;
    if (/^\d/.test(t)) current += parseCopAmount(t) ?? 0;
    else if (t in UNITS) current += UNITS[t]!;
    else if (t in TENS) current += TENS[t]!;
    else if (t in HUNDREDS) current += HUNDREDS[t]!;
    else if (t === 'mil') { total += (current || 1) * 1_000; current = 0; }
    else if (t === 'millon' || t === 'millones') { total += (current || 1) * 1_000_000; current = 0; }
  }
  const v = total + current;
  return any && v > 0 ? v : null;
}

const INCOME_RE = /\b(recibi|cobre|gane|me pagaron|me llegaron|me consignaron|ingrese|ingreso|me depositaron)\b/;
const VERB_RE = /\b(gaste|pague|compre|me pagaron|me llegaron|recibi|cobre|gane|ingrese|ingreso|deposite|inverti|transferi|envie)\b/g;

export function parseSpokenExpense(speech: string): SpokenTx {
  const norm = normalizeText(speech).replace(/[,;:]/g, ' ');
  const tokens = norm.split(/\s+/).filter(Boolean);

  // Racha numérica más larga (la que más tokens tenga).
  let best: { start: number; end: number } | null = null;
  for (let i = 0; i < tokens.length; i++) {
    if (!isNumToken(tokens[i]!) || tokens[i] === 'y') continue;
    let j = i;
    while (j < tokens.length && isNumToken(tokens[j]!)) j++;
    if (!best || j - i > best.end - best.start) best = { start: i, end: j };
    i = j - 1;
  }

  const type = INCOME_RE.test(norm) ? 'income' : 'expense';
  if (!best) return { type, amount: null, merchant: null };

  const run = tokens.slice(best.start, best.end);
  while (run.at(-1) === 'y') run.pop();
  const amount = sumTokens(run);

  const clean = (parts: string[]) =>
    parts
      .join(' ')
      .replace(VERB_RE, ' ')
      .replace(/\b(pesos|peso|cop|plata)\b/g, ' ')
      .replace(/^\s*(en|de|del|para|por|a|con)\s+/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\s+(en|de|del|para|por|a|con)$/, '');

  let merchant = clean(tokens.slice(best.end));
  if (!merchant) merchant = clean(tokens.slice(0, best.start));
  merchant = merchant.replace(/^(en|de|del|para|por|a|con)\s+/, '').trim();
  return { type, amount, merchant: merchant ? merchant.slice(0, 40) : null };
}
