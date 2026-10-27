/**
 * Interpreta el texto de una notificación bancaria.
 */
export type PaymentMethod = 'bnpl' | 'credit' | 'debit' | 'unknown';

export interface ParsedNotification {
  type: 'expense' | 'income';
  amount: number;
  merchant: string | null;
  paymentMethod: PaymentMethod;
  isDebtPayment: boolean;
  needsInstallments: boolean;
  suggestedInstallments: number | null;
}

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

function extractAmount(text: string): number | null {
  // Añadimos "envió" (singular) y "enviaron" para capturar números sin $
  const re = /(?:\$|\b(?:recibiste|pagaste|compraste|enviaste|env[ií]o|envi[oó]|transfiriste|monto|valor|total|por)\b)\s*(\d[\d.,]*\d|\d)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const before = text.slice(Math.max(0, m.index - 24), m.index);
    if (/saldo|disponible|cupo|l[ií]mite/i.test(before)) continue;
    
    const rawNumber = m[1]!;
    if (!rawNumber) continue;
    const preText = text.slice(Math.max(0, m.index - 5), m.index);
    if (rawNumber.length === 4 && /[*xX]/.test(preText)) continue;

    const value = parseCopAmount(rawNumber);
    if (value) return value;
  }
  return null;
}

// Añadimos "te envió" y "te envio" al patrón de ingresos
const INCOME_RE = /recibiste|te\s+(?:enviaron|envi[oó]|lleg[oó]|llegaron|consignaron|transfirieron|pagaron|depositaron)|abono|dep[oó]sito|consignaci[oó]n|ingreso\s+de|te\s+enviaron\s+plata|transferencia\s+recibida|bre[-\s]?b|llave/i;
const EXPENSE_RE = /enviaste|env[ií]o|compraste|compra|pagaste|pago|retiro|retiraste|transferiste|d[eé]bito|cargo|avance|cobro|se\s+descont|pago\s+por|bre[-\s]?b|llave/i;
const DEBT_PAYMENT_RE = /(?:pagaste|pago\s+(?:de|a))\s+(?:tu\s+|la\s+)?(?:cuota|tarjeta|cr[eé]dito|pr[eé]stamo|factura\s+de\s+tarjeta|deuda)/i;
const CREDIT_HINT_RE = /cr[eé]dito|cuotas?\b|diferid|financi/i;
const DEBIT_HINT_RE = /d[eé]bito|ahorros|cuenta\s+(?:corriente|de\s+ahorros)/i;
const BRE_B_RE = /bre[-\s]?b|llave/i;

function extractMerchant(text: string): string | null {
  const clean = text.replace(/\ben\s+\d+\s+cuotas?/gi, ' ');
  const m1 = /\ben\s+(.+?)(?=\s+(?:con|el|por|usando|desde|a\s+las)\b|[.,;]|$)/i.exec(clean);
  const m2 = /\ba\s+([A-Z\s*]+?)(?=\s+en\b|[.,;]|$)/i.exec(clean); 
  
  const merchant = m1?.[1]?.trim() || m2?.[1]?.trim();
  if (!merchant || /^(?:tu|la|el|su)\b/i.test(merchant) || /\d{3,}/.test(merchant)) return null;
  return merchant.slice(0, 60);
}

export function parseNotification(
  maskedText: string,
  sourceKind: 'bank' | 'wallet' | 'bnpl',
): ParsedNotification | null {
  const amount = extractAmount(maskedText);
  if (!amount) return null;

  const isIncome = INCOME_RE.test(maskedText) && !/pagaste|compraste|enviaste|env[ií]o/i.test(maskedText);
  const isExpense = EXPENSE_RE.test(maskedText);
  if (!isIncome && !isExpense) return null;

  const type = isIncome ? 'income' : 'expense';
  const isDebtPayment = type === 'expense' && DEBT_PAYMENT_RE.test(maskedText);

  let paymentMethod: PaymentMethod = 'unknown';
  if (sourceKind === 'bnpl') paymentMethod = 'bnpl';
  else if (CREDIT_HINT_RE.test(maskedText)) paymentMethod = 'credit';
  else if (DEBIT_HINT_RE.test(maskedText) || BRE_B_RE.test(maskedText)) paymentMethod = 'debit';

  const suggested = /\b(\d{1,2})\s+cuotas?\b/i.exec(maskedText);
  const suggestedInstallments = suggested ? Number(suggested[1]) : null;

  return {
    type,
    amount,
    merchant: type === 'expense' ? extractMerchant(maskedText) : null,
    paymentMethod,
    isDebtPayment,
    needsInstallments: type === 'expense' && !isDebtPayment && (paymentMethod === 'bnpl' || paymentMethod === 'credit'),
    suggestedInstallments: suggestedInstallments && suggestedInstallments > 0 ? suggestedInstallments : null,
  };
}