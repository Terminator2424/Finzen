import { parseNotification, type ParsedNotification } from './parse';
import { dedupeHash, isOtp, maskSensitive } from './sanitize';
import { DEFAULT_SOURCES, matchSource, type NotificationSource } from './sources';

export interface RawNotification {
  packageName: string;
  title?: string;
  text: string;
  /** epoch ms */
  receivedAt: number;
}

export type PipelineResult =
  /** App fuera de la lista blanca: no se lee ni se guarda NADA del contenido. */
  | { outcome: 'discarded_not_whitelisted' }
  /** Posible OTP/credencial: no se guarda el texto. */
  | { outcome: 'discarded_otp'; sourceId: string }
  /** App permitida pero formato no reconocido: se conserva el texto enmascarado para depurar. */
  | { outcome: 'discarded_unparsed'; sourceId: string; maskedText: string }
  | {
      outcome: 'imported';
      sourceId: string;
      maskedText: string;
      dedupeHash: string;
      parsed: ParsedNotification;
    };

const MAX_TEXT = 300;
/** Tope de lo que se analiza: una notificación enorme no debe poder alentar la app. */
const MAX_INPUT = 2000;
/** El descarte de OTP revisa MÁS texto que el que se analiza, para que no se pueda esconder una clave tras relleno. */
const MAX_OTP_SCAN = 20_000;

/**
 * Orden de seguridad (no alterar):
 *   1. lista blanca  → si no está, ni se mira el texto
 *   2. descarte OTP  → antes de enmascarar y de registrar nada
 *   3. enmascarado   → todo lo que sigue (parseo, hash, bitácora, sync) usa texto ya limpio
 *   4. parseo
 * El texto original nunca sale de esta función.
 */
export function processNotification(
  n: RawNotification,
  sources: NotificationSource[] = DEFAULT_SOURCES,
): PipelineResult {
  const source = matchSource(n.packageName, sources);
  if (!source) return { outcome: 'discarded_not_whitelisted' };

  const combined = `${n.title ?? ''} ${n.text}`.trim().slice(0, MAX_OTP_SCAN);
  if (isOtp(combined)) return { outcome: 'discarded_otp', sourceId: source.id };

  const maskedText = maskSensitive(combined.slice(0, MAX_INPUT)).slice(0, MAX_TEXT);
  const parsed = parseNotification(maskedText, source.kind);
  if (!parsed) return { outcome: 'discarded_unparsed', sourceId: source.id, maskedText };

  // Mismo texto en el mismo minuto = misma notificación (Android a veces la entrega dos veces).
  const minuteBucket = Math.floor(n.receivedAt / 60_000);
  return {
    outcome: 'imported',
    sourceId: source.id,
    maskedText,
    dedupeHash: dedupeHash(`${source.id}|${minuteBucket}|${maskedText}`),
    parsed,
  };
}
