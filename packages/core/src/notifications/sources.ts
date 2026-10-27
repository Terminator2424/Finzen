/**
 * Lista blanca de apps cuyas notificaciones se leen.
 * TOTALMENTE VACÍA: La app dependerá 100% del "Modo Aprendizaje".
 */
export type SourceKind = 'bank' | 'wallet' | 'bnpl';

export interface NotificationSource {
  id: string;
  label: string;
  kind: SourceKind;
  packagePattern: string;
}

export const DEFAULT_SOURCES: NotificationSource[] = []; // <-- Sin apps por defecto

export function matchSource(
  packageName: string,
  sources: NotificationSource[] = DEFAULT_SOURCES,
): NotificationSource | null {
  const pkg = packageName.toLowerCase();
  return sources.find((s) => new RegExp(s.packagePattern).test(pkg)) ?? null;
}