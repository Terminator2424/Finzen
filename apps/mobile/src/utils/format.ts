/** Tope de dígitos de un monto (13 → hasta 9.999.999.999.999): evita desbordes y números imprecisos. */
const MAX_DIGITS = 13;

/** Formatea pesos: 1250000 → "$1.250.000" (a mano: no depende de Intl en Hermes). */
export function formatCOP(n: number): string {
  const sign = n < 0 ? '-' : '';
  const digits = Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}$${digits}`;
}

/** Deja solo dígitos y devuelve el número (0 si está vacío). */
export function parseDigits(s: string): number {
  const d = s.replace(/\D/g, '').slice(0, MAX_DIGITS);
  return d ? Number(d) : 0;
}

/** Texto de un input monetario mientras se escribe: "1250000" → "1.250.000". */
export function groupDigits(s: string): string {
  const d = s.replace(/\D/g, '').slice(0, MAX_DIGITS);
  return d.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
