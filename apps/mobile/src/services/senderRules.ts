import { getSetting, setSetting } from './repo';

/**
 * Apps donde llegan mensajes de MUCHOS remitentes (WhatsApp, SMS). Solo se leen los remitentes de la lista:
 * lo demás se descarta en el servicio nativo sin leerse.
 * Clave = paquete de Android. Valor = primera palabra normalizada del título de la notificación.
 * Estos son los valores por defecto; el usuario puede editarlos (ver getSenderRules).
 */
export const SENDER_RULES: Record<string, string[]> = {
  'com.whatsapp': ['addi', 'sistecredito'],
  'com.whatsapp.w4b': ['addi', 'sistecredito'],
  'com.google.android.apps.messages': ['tigo'],
  'com.samsung.android.messaging': ['tigo'],
};

/** Apps de SMS: casi todo lo que no se entiende es publicidad, así que no va a Borradores. */
export const SMS_PACKAGES = new Set(['com.google.android.apps.messages', 'com.samsung.android.messaging']);

const KEY = 'sender_rules';

/**
 * Un remitente es UNA palabra (el servicio nativo compara con la primera palabra del título):
 * sin tildes, en minúsculas, de 3 a 20 caracteres. Sin comodines.
 */
export function normalizeSender(input: string): string | null {
  const w = input.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]+/);
  const s = w?.[0] ?? '';
  return s.length >= 3 && s.length <= 20 ? s : null;
}

/**
 * Reglas efectivas: las guardadas por el usuario o, si no hay, las predeterminadas.
 * Un paquete predeterminado NUNCA pierde su regla: sin regla se leerían TODOS los chats o SMS.
 * Lista vacía = no se lee nada de esa app.
 */
export async function getSenderRules(): Promise<Record<string, string[]>> {
  try {
    const raw = await getSetting(KEY);
    if (!raw) return SENDER_RULES;
    const o = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string[]> = {};
    for (const [pkg, v] of Object.entries(o)) {
      if (!/^[a-z0-9_.]{3,100}$/i.test(pkg) || !Array.isArray(v)) continue;
      const names = v.map((x) => (typeof x === 'string' ? normalizeSender(x) : null)).filter((x): x is string => !!x);
      out[pkg] = [...new Set(names)].slice(0, 10);
    }
    for (const pkg of Object.keys(SENDER_RULES)) if (!(pkg in out)) out[pkg] = [];
    return out;
  } catch {
    return SENDER_RULES;
  }
}

export async function saveSenderRules(rules: Record<string, string[]>): Promise<void> {
  await setSetting(KEY, JSON.stringify(rules), 'device');
}

export async function resetSenderRules(): Promise<void> {
  await setSetting(KEY, '', 'device');
}