/**
 * Lista blanca de apps cuyas notificaciones se leen.
 * TOTALMENTE VACIA: la app depende 100% del "Modo Aprendizaje".
 */
export type SourceKind = 'bank' | 'wallet' | 'bnpl';

export interface NotificationSource {
  id: string;
  label: string;
  kind: SourceKind;
  packagePattern: string;
}

export const DEFAULT_SOURCES: NotificationSource[] = []; // Sin apps por defecto

/** Un patron invalido (p. ej. de un respaldo corrupto) se ignora: nunca debe tumbar la ingesta. */
function safeTest(pattern: string, pkg: string): boolean {
  if (pattern.length === 0 || pattern.length > 200) return false;
  try {
    return new RegExp(pattern).test(pkg);
  } catch {
    return false;
  }
}

export function matchSource(
  packageName: string,
  sources: NotificationSource[] = DEFAULT_SOURCES,
): NotificationSource | null {
  const pkg = packageName.toLowerCase();
  return sources.find((s) => safeTest(s.packagePattern, pkg)) ?? null;
}