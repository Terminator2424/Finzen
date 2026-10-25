/**
 * Migración 003 — anclaje de fuentes de notificación.
 *
 * Los patrones de la lista blanca (p. ej. "nequi") coinciden por subcadena, así que una app
 * maliciosa llamada "com.evil.nequi" pasaría el filtro e inyectaría "transacciones" falsas.
 * `bound_package` guarda el paquete EXACTO que produjo la primera notificación válida de esa
 * fuente (confianza en el primer uso); desde entonces solo ese paquete cuenta.
 */
export const MIGRATION_003_SOURCE_BINDING = /* sql */ `
ALTER TABLE notification_sources ADD COLUMN bound_package TEXT;
`;
