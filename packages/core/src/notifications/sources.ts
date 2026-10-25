/**
 * Lista blanca por defecto de apps cuyas notificaciones se leen.
 *
 * ⚠️ Los patrones de packageName son HEURÍSTICOS (no los he verificado contra Play Store).
 * Por eso la app incluirá un "modo aprendizaje" en Ajustes: muestra de qué apps llegan
 * notificaciones y el usuario confirma cuáles son sus bancos. Hasta confirmar, todo se
 * trata como "no verificado". El filtro real se hace en Kotlin ANTES de pasar texto a JS.
 */

export type SourceKind = 'bank' | 'wallet' | 'bnpl';

export interface NotificationSource {
  id: string;
  label: string;
  kind: SourceKind;
  /** Regex (sin delimitadores) que se prueba contra el packageName en minúsculas. */
  packagePattern: string;
}

/** El orden importa: gana la primera coincidencia (daviplata antes que davivienda). */
export const DEFAULT_SOURCES: NotificationSource[] = [
  { id: 'daviplata', label: 'Daviplata', kind: 'wallet', packagePattern: 'daviplata' },
  { id: 'davivienda', label: 'Davivienda', kind: 'bank', packagePattern: 'davivienda' },
  { id: 'nequi', label: 'Nequi', kind: 'wallet', packagePattern: 'nequi' },
  { id: 'nu', label: 'Nu', kind: 'bank', packagePattern: '^com\\.nu\\.' },
  { id: 'bancolombia', label: 'Bancolombia', kind: 'bank', packagePattern: 'bancolombia|todo1' },
  { id: 'bbva', label: 'BBVA', kind: 'bank', packagePattern: 'bbva' },
  { id: 'lulo', label: 'Lulo Bank', kind: 'bank', packagePattern: 'lulo' },
  { id: 'rappipay', label: 'RappiPay', kind: 'wallet', packagePattern: 'rappipay' },
  { id: 'addi', label: 'Addi', kind: 'bnpl', packagePattern: '(^|\\.)addi(\\.|$)' },
  { id: 'sistecredito', label: 'Sistecrédito', kind: 'bnpl', packagePattern: 'sistecredito' },
];

/** Devuelve la fuente de la lista blanca que coincide con el paquete, o null. */
export function matchSource(
  packageName: string,
  sources: NotificationSource[] = DEFAULT_SOURCES,
): NotificationSource | null {
  const pkg = packageName.toLowerCase();
  return sources.find((s) => new RegExp(s.packagePattern).test(pkg)) ?? null;
}
