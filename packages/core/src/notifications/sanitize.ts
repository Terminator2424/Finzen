/**
 * Filtros de seguridad para notificaciones. Principio rector: ante la duda, DESCARTAR.
 * Perder una transacción se arregla agregándola a mano; filtrar una clave, no.
 */

const OTP_PATTERNS: RegExp[] = [
  /c[oó]digo\s+(?:de\s+)?(?:verificaci[oó]n|seguridad|confirmaci[oó]n|acceso|ingreso)/i,
  /\botp\b/i,
  /clave\s+(?:temporal|din[aá]mica|de\s+un\s+solo\s+uso|de\s+(?:acceso|seguridad))/i,
  /contrase[ñn]a\s+(?:temporal|de\s+un\s+solo\s+uso)/i,
  /\btoken\b/i,
  /no\s+(?:lo\s+|la\s+)?compartas/i,
  /nunca\s+(?:te\s+)?(?:pediremos|solicitaremos)/i,
  /(?:tu|su)\s+c[oó]digo\s+(?:es|:)/i,
];

/** ¿Parece un mensaje con credenciales de un solo uso? */
export function isOtp(text: string): boolean {
  return OTP_PATTERNS.some((re) => re.test(text));
}

const last4 = (digits: string) => '****' + digits.slice(-4);

/**
 * Enmascara datos sensibles dejando solo los últimos 4 dígitos.
 * Orden importa: tarjetas (12-19 dígitos con separadores) → teléfonos → cualquier
 * número largo → correos. Los montos ($50.000, $1.250.000,50) NO se tocan: llevan
 * separadores de miles o van precedidos de "$".
 */
export function maskSensitive(text: string): string {
  return (
    text
      // Tarjetas / cuentas con espacios o guiones: 4111 1111 1111 1111, 4111-1111-1111-1111
      // (el "+" excluido evita que un +57 3001234567 se confunda con una tarjeta)
      .replace(/(?<![$\d.,+])(?:\d[ -]?){11,18}\d(?!\d)/g, (m) => last4(m.replace(/\D/g, '')))
      // Celulares colombianos: 300 123 4567, +57 300 123 4567
      .replace(/(?<![$\d.,])(?:\+57[ -]?|57[ -]?)?3\d{2}[ -]?\d{3}[ -]?\d{4}(?!\d)/g, (m) =>
        last4(m.replace(/\D/g, '')),
      )
      // Cualquier otra secuencia larga de dígitos (cuentas, cédulas) sin "$" delante
      .replace(/(?<![$\d.,])\d{9,}(?!\d)/g, (m) => last4(m))
      // Correos: j***@dominio.com
      .replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, '$1***@$2')
  );
}

/**
 * Hash no criptográfico (cyrb53) para detectar notificaciones duplicadas.
 * No protege nada: solo identifica. Se calcula sobre el texto YA enmascarado.
 */
export function dedupeHash(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
