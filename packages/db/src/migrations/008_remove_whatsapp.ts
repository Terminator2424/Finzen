/**
 * Migración 008 — WhatsApp ya no se lee.
 * Borra las fuentes de WhatsApp (para que no queden en la lista blanca) y los avisos de WhatsApp
 * que se hubieran guardado ya enmascarados en la bitácora.
 */
export const MIGRATION_008_REMOVE_WHATSAPP = /* sql */ `
DELETE FROM notification_sources WHERE lower(package_pattern) LIKE '%whatsapp%' OR lower(label) LIKE '%whatsapp%';
DELETE FROM notifications_log WHERE lower(source_package) LIKE '%whatsapp%';
`;