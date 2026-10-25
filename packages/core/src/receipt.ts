import { parseDate } from './csv';
import { parseCopAmount } from './notifications/parse';

/**
 * Interpreta el texto que el OCR sacó de un recibo/factura. El OCR no es perfecto:
 * el resultado siempre se muestra al usuario para confirmarlo antes de guardar.
 */
export interface ParsedReceipt {
  amount: number | null;
  merchant: string | null;
  /** epoch ms */
  date: number | null;
}

const NUM_RE = /\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/g;

function amountsIn(line: string): number[] {
  return (line.match(NUM_RE) ?? [])
    .map((m) => parseCopAmount(m))
    .filter((v): v is number => v !== null && v >= 100); // descarta cantidades sueltas tipo "2"
}

export function parseReceiptText(text: string): ParsedReceipt {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Total: la última línea con "total" que no sea subtotal; si no hay, el monto más grande.
  let amount: number | null = null;
  for (const line of lines) {
    if (/\btotal\b/i.test(line) && !/sub\s*-?\s*total/i.test(line)) {
      const a = amountsIn(line);
      if (a.length) amount = Math.max(...a);
    }
  }
  if (amount === null) {
    const all = lines.flatMap(amountsIn);
    if (all.length) amount = Math.max(...all);
  }

  // Comercio: primera línea con al menos 3 letras que no parezca dirección, fecha o NIT.
  const merchant =
    lines.find((l) => {
      const letters = (l.match(/\p{L}/gu) ?? []).length;
      return letters >= 3 && !/nit|n\.i\.t|factura|tel[eé]fono|cll|calle|carrera|cra\b|www\.|@|\d{2}[/-]\d{2}/i.test(l);
    }) ?? null;

  let date: number | null = null;
  for (const l of lines) {
    const m = /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/.exec(l);
    if (m) { date = parseDate(m[0]); if (date) break; }
  }
  return { amount, merchant: merchant ? merchant.slice(0, 60) : null, date };
}
