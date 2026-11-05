/**
 * Apps donde llegan mensajes de MUCHOS remitentes (WhatsApp, SMS). Solo se leen los remitentes de esta
 * lista: lo demas se descarta en el servicio nativo sin leerse.
 * Clave = paquete de Android. Valor = primer "token" normalizado del titulo de la notificacion
 * (nombre del contacto o remitente del SMS).
 */
export const SENDER_RULES: Record<string, string[]> = {
  'com.whatsapp': ['addi', 'sistecredito'],
  'com.whatsapp.w4b': ['addi', 'sistecredito'],
  'com.google.android.apps.messages': ['tigo'],
  'com.samsung.android.messaging': ['tigo'],
};

/** Apps de SMS: casi todo lo que no se entiende es publicidad, asi que no va a Borradores. */
export const SMS_PACKAGES = new Set(['com.google.android.apps.messages', 'com.samsung.android.messaging']);