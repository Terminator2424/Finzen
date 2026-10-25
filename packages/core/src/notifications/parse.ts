/**
 * Interpreta el texto (ya enmascarado) de una notificación bancaria en español.
 * Son heurísticas con expresiones regulares: cubren los formatos comunes y devuelven
 * null cuando no están seguras. Una transacción que no se reconoce se descarta y se
 * deja en la bitácora para mejorar el parser; nunca se adivina un monto.
 */

export type PaymentMethod = 'bnpl' | 'credit' | 'debit' | 'unknown';

export interface ParsedNotification {
  type: 'expense' | 'income';
  /** Pesos enteros, siempre positivo. */
  amount: number;
  merchant: string | null;
  paymentMethod: PaymentMethod;
  /** Pago de una cuota/tarjeta (reduce una deuda; no es una compra nueva). */
  isDebtPayment: boolean;
  /** Compra a crédito: al abrir la app hay que preguntar cuántas cuotas. */
  needsInstallments: boolean;
  /** Si la notificación ya dice "en 6 cuotas", se propone ese valor. */
  suggestedInstallments: number | null;
}

/**
 * Convierte "50.000", "1.250.000,50", "50,000.75" o "50" a pesos enteros.
 * Regla para separadores: si hay ambos, el último es el decimal; si hay uno solo
 * y lo siguen exactamente 3 dígitos (o se repite) es de miles ("50.000"); si no, decimal.
 */
export function parseCopAmount(raw: string): number | null {
  const hasDot = raw.includes('.');
  const hasComma = raw.includes(',');
  let decimalSep: '.' | ',' | null = null;

  if (hasDot && hasComma) {
    decimalSep = raw.lastIndexOf('.') > raw.lastIndexOf(',') ? '.' : ',';
  } else if (hasDot || hasComma) {
    const sep = hasDot ? '.' : ',';
    const parts = raw.split(sep);
    const last = parts[parts.length - 1]!;
    if (parts.length === 2 && last.length !== 3) decimalSep = sep;
  }

  let intPart = raw;
  let decPart = '0';
  if (decimalSep) {
    const idx = raw.lastIndexOf(decimalSep);
    intPart = raw.slice(0, idx);
    decPart = raw.slice(idx + 1);
  }
  const value = Number(intPart.replace(/[.,]/g, '') + '.' + decPart);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

/** Primer monto "$..." o número tras palabra clave que no sea un saldo/cupo/disponible. */
function extractAmount(text: string): number | null {
  // El $ ahora es opcional, o buscamos números que sigan a palabras clave de transacción
  const re = /(?:\$|\b(?:recibiste|pagaste|compraste|enviaste|transfiriste|monto|valor|total|por)\b)\s*(\d[\d.,]*\d|\d)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const before = text.slice(Math.max(0, m.index - 24), m.index);
    if (/saldo|disponible|cupo|l[ií]mite/i.test(before)) continue;
    
    const rawNumber = m[1]!;
    if (!rawNumber) continue;
    // Protección: ignorar números de 4 dígitos sin formato (ej. últimos 4 de tarjeta)
    const preText = text.slice(Math.max(0, m.index - 5), m.index);
    if (rawNumber.length === 4 && /[*xX]/.test(preText)) continue; // Solo ignora si parece una tarjeta

    const value = parseCopAmount(rawNumber);
    if (value) return value;
  }
  return null;
}

const INCOME_RE =
  /recibiste|te\s+(?:enviaron|lleg[oó]|llegaron|consignaron|transfirieron|pagaron)|abono|dep[oó]sito|consignaci[oó]n|ingreso\s+de/i;
const EXPENSE_RE =
  /compraste|compra|pagaste|pago|retiro|retiraste|enviaste|transferiste|d[eé]bito|cargo|avance|cobro|se\s+descont/i;
const DEBT_PAYMENT_RE =
  /(?:pagaste|pago\s+(?:de|a))\s+(?:tu\s+|la\s+)?(?:cuota|tarjeta|cr[eé]dito|pr[eé]stamo|factura\s+de\s+tarjeta)/i;
const CREDIT_HINT_RE = /cr[eé]dito|cuotas?\b|diferid|financi/i;
const DEBIT_HINT_RE = /d[eé]bito|ahorros|cuenta\s+(?:corriente|de\s+ahorros)/i;

function extractMerchant(text: string): string | null {
  // "en 3 cuotas" no es un comercio
  const clean = text.replace(/\ben\s+\d+\s+cuotas?/gi, ' ');
  const m = /\ben\s+(.+?)(?=\s+(?:con|el|por|usando|desde|a\s+las)\b|[.,;]|$)/i.exec(clean);
  const merchant = m?.[1]?.trim();
  if (!merchant || /^(?:tu|la|el)\b/i.test(merchant) || /\d{3,}/.test(merchant)) return null;
  return merchant.slice(0, 60);
}

export function parseNotification(
  maskedText: string,
  sourceKind: 'bank' | 'wallet' | 'bnpl',
): ParsedNotification | null {
  const amount = extractAmount(maskedText);
  if (!amount) return null;

  const isIncome = INCOME_RE.test(maskedText) && !/pagaste|compraste/i.test(maskedText);
  const isExpense = EXPENSE_RE.test(maskedText);
  if (!isIncome && !isExpense) return null;

  const type = isIncome ? 'income' : 'expense';
  const isDebtPayment = type === 'expense' && DEBT_PAYMENT_RE.test(maskedText);

  let paymentMethod: PaymentMethod = 'unknown';
  if (sourceKind === 'bnpl') paymentMethod = 'bnpl';
  else if (CREDIT_HINT_RE.test(maskedText)) paymentMethod = 'credit';
  else if (DEBIT_HINT_RE.test(maskedText)) paymentMethod = 'debit';

  const suggested = /\b(\d{1,2})\s+cuotas?\b/i.exec(maskedText);
  const suggestedInstallments = suggested ? Number(suggested[1]) : null;

  return {
    type,
    amount,
    merchant: type === 'expense' ? extractMerchant(maskedText) : null,
    paymentMethod,
    isDebtPayment,
    needsInstallments:
      type === 'expense' && !isDebtPayment && (paymentMethod === 'bnpl' || paymentMethod === 'credit'),
    suggestedInstallments: suggestedInstallments && suggestedInstallments > 0 ? suggestedInstallments : null,
  };
}