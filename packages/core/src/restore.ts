/**
 * Validación de respaldos a restaurar. Un archivo de respaldo NO es de confianza: puede venir
 * de otra persona o estar manipulado. Reglas:
 *  - Solo se aceptan ajustes de una lista cerrada (tema y estado del onboarding). Un respaldo
 *    jamás debe poder cambiar ajustes de dispositivo (PIN, IA, URL de Ollama…): por ejemplo,
 *    apuntar la IA a un servidor del atacante para recibir tus totales.
 *  - Tamaño y número de filas acotados (evita agotar la memoria).
 *  - Todo valor se escribe con parámetros; los nombres de columna se filtran contra el esquema.
 */
export const RESTORABLE_SETTINGS = ['palette', 'mode', 'onboarded'] as const;
export const MAX_BACKUP_CHARS = 30_000_000;
export const MAX_BACKUP_ROWS = 200_000;

export interface SettingRow { key: string; value: string; updated_at?: number }

/** Deja solo los ajustes permitidos y fuerza su ámbito a 'user'. */
export function filterRestoredSettings(rows: unknown): { key: string; value: string; scope: 'user'; updated_at: number }[] {
  if (!Array.isArray(rows)) return [];
  const out: { key: string; value: string; scope: 'user'; updated_at: number }[] = [];
  for (const r of rows as SettingRow[]) {
    if (!r || typeof r.key !== 'string' || typeof r.value !== 'string') continue;
    if (!(RESTORABLE_SETTINGS as readonly string[]).includes(r.key)) continue;
    if (r.key === 'palette' && !['purple', 'blue'].includes(r.value)) continue;
    if (r.key === 'mode' && !['light', 'dark', 'auto'].includes(r.value)) continue;
    if (r.key === 'onboarded' && r.value !== '1') continue;
    out.push({ key: r.key, value: r.value, scope: 'user', updated_at: Number.isFinite(r.updated_at) ? Number(r.updated_at) : Date.now() });
  }
  return out;
}

/** ¿Es un objeto-fila plano? (descarta null, arrays, anidados). */
export function isPlainRow(r: unknown): r is Record<string, string | number | null> {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
  return Object.values(r as object).every((v) => v === null || typeof v === 'string' || typeof v === 'number');
}

/** Cuenta filas y rechaza respaldos desproporcionados. */
export function assertBackupSize(text: string, tables: Record<string, unknown[]>): void {
  if (text.length > MAX_BACKUP_CHARS) throw new Error('El respaldo es demasiado grande.');
  let n = 0;
  for (const rows of Object.values(tables)) n += Array.isArray(rows) ? rows.length : 0;
  if (n > MAX_BACKUP_ROWS) throw new Error('El respaldo tiene demasiadas filas.');
}
