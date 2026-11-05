import { parseCopAmount } from './parse';

/**
 * Aviso de FACTURA POR PAGAR (p. ej. SMS de Tigo: "Ya generamos tu factura de OCTUBRE ... por $19,900,
 * limite de pago 21/11/2026"). NO es un gasto: todavia no se ha pagado nada.
 */
export interface BillNotice {
  amount: number;
  /** 'YYYY-MM-DD', o null si el aviso no trae fecha limite. */
  dueDate: string | null;
  /** Periodo facturado en minusculas ('octubre'), o null. */
  period: string | null;
}

const BILL_RE = /ya\s+generamos\s+tu\s+factura|tu\s+factura\s+(?:de|est[aá]|ya)|factura\s+(?:disponible|generada)/i;
const PAID_RE = /\b(?:pagaste|recibimos\s+tu\s+pago|pago\s+recibido|pago\s+exitoso)\b/i;
const AMOUNT_RE = /\$\s*(\d[\d.,]*\d|\d)/;
const DUE_RE = /l[ií]mite\s+de\s+pago\s*:?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i;
const PERIOD_RE = /factura\s+de\s+([a-záéíóúñ]+)/i;

export function parseBillNotice(text: string): BillNotice | null {
  if (!BILL_RE.test(text) || PAID_RE.test(text)) return null;
  const m = AMOUNT_RE.exec(text);
  const amount = m ? parseCopAmount(m[1]!) : null;
  if (!amount) return null;
  const d = DUE_RE.exec(text);
  const dueDate = d ? `${d[3]}-${d[2]!.padStart(2, '0')}-${d[1]!.padStart(2, '0')}` : null;
  const p = PERIOD_RE.exec(text);
  return { amount, dueDate, period: p ? p[1]!.toLowerCase() : null };
}