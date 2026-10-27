import { processNotification, type NotificationSource, type RawNotification } from '@finzen/core';
import { getDb } from './db';
import { adjustAccount, uid, writeRow } from './repo';
import { suggestCategory } from './transactions';

/**
 * Recibe una notificación cruda (de Android o del simulador), la pasa por el pipeline de
 * seguridad de @finzen/core y guarda el resultado. El texto original NO se guarda nunca:
 * solo la versión enmascarada, y nada si fue OTP o de una app fuera de la lista blanca.
 */
export type IngestOutcome = 'imported' | 'duplicate' | 'discarded_otp' | 'discarded_not_whitelisted' | 'discarded_unparsed';

async function loadSources(): Promise<NotificationSource[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; label: string; kind: 'bank' | 'wallet' | 'bnpl'; package_pattern: string }>(
    'SELECT id,label,kind,package_pattern FROM notification_sources WHERE enabled=1',
  );
  return rows.map((r) => ({ id: r.id, label: r.label, kind: r.kind, packagePattern: r.package_pattern }));
}

const LOG_DAYS = 30;
const LOG_MAX_ROWS = 500;

/** Minimización de datos: la bitácora de notificaciones no crece sin límite. */
async function pruneLog(db: Awaited<ReturnType<typeof getDb>>): Promise<void> {
  await db.runAsync('DELETE FROM notifications_log WHERE received_at < ?', [Date.now() - LOG_DAYS * 86_400_000]);
  await db.runAsync(
    'DELETE FROM notifications_log WHERE id NOT IN (SELECT id FROM notifications_log ORDER BY received_at DESC LIMIT ?)',
    [LOG_MAX_ROWS],
  );
}

/**
 * Anclaje de fuente (confianza en el primer uso). Los patrones de la lista blanca coinciden por
 * subcadena: una app maliciosa "com.evil.nequi" pasaría el filtro. Por eso, la primera notificación
 * VÁLIDA de cada fuente fija su paquete exacto y desde entonces solo ese paquete cuenta.
 * Devuelve false si el paquete NO es el anclado (posible suplantación).
 */
async function checkBinding(db: Awaited<ReturnType<typeof getDb>>, sourceId: string, pkg: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ bound_package: string | null }>('SELECT bound_package FROM notification_sources WHERE id=?', [sourceId]);
  if (!row) return false;
  if (row.bound_package === null) {
    await db.runAsync('UPDATE notification_sources SET bound_package=? WHERE id=? AND bound_package IS NULL', [pkg, sourceId]);
    return true;
  }
  return row.bound_package === pkg;
}

export async function ingestNotification(raw: RawNotification): Promise<IngestOutcome> {
  const db = await getDb();
  const sources = await loadSources();
  const result = processNotification(raw, sources);
  await pruneLog(db);
  const logId = uid();
  const log = (outcome: IngestOutcome, maskedText: string | null, hash: string | null, txId: string | null) =>
    db.runAsync(
      'INSERT INTO notifications_log (id,source_package,received_at,masked_text,text_hash,outcome,transaction_id) VALUES (?,?,?,?,?,?,?)',
      [logId, raw.packageName, raw.receivedAt, maskedText, hash, outcome, txId],
    );

  if (result.outcome === 'discarded_not_whitelisted') {
    // Ni siquiera se registra el paquete: no queremos un historial de qué apps usa la persona.
    return 'discarded_not_whitelisted';
  }
  if (result.outcome === 'discarded_otp') { await log('discarded_otp', null, null, null); return 'discarded_otp'; }
  if (result.outcome === 'discarded_unparsed') { await log('discarded_unparsed', result.maskedText, null, null); return 'discarded_unparsed'; }

  // ¿El paquete es el verdadero de esa fuente? Si no, se ignora y se deja constancia (sin texto).
  if (!(await checkBinding(db, result.sourceId, raw.packageName))) {
    await log('discarded_not_whitelisted', null, null, null);
    return 'discarded_not_whitelisted';
  }

  const dup = await db.getFirstAsync<{ id: string }>('SELECT id FROM transactions WHERE dedupe_hash=?', [result.dedupeHash]);
  if (dup) { await log('duplicate', result.maskedText, result.dedupeHash, dup.id); return 'duplicate'; }

  const p = result.parsed;
  const source = sources.find((s) => s.id === result.sourceId);
  const now = Date.now();
  const txId = uid();
  const categoryId = p.isDebtPayment ? 'cat_deudas' : p.type === 'income' ? 'cat_ingreso_otros' : p.merchant ? await suggestCategory(p.merchant) : null;
  const status = p.needsInstallments ? 'needs_installments' : 'posted';

  // Cuenta asociada: la que se llame como la app (p. ej. app "Nequi" → cuenta "Nequi").
  let accountId: string | null = null;
  if (!p.needsInstallments && p.paymentMethod !== 'credit' && source) {
    const acc = await db.getFirstAsync<{ id: string }>(
      "SELECT id FROM accounts WHERE deleted_at IS NULL AND archived=0 AND lower(name) LIKE '%' || lower(?) || '%' LIMIT 1",
      [source.label],
    );
    accountId = acc?.id ?? null;
  }

  await db.withTransactionAsync(async () => {
    await writeRow(db, 'transactions', {
      id: txId, account_id: accountId, category_id: categoryId, debt_id: null,
      type: p.type, amount: p.amount, merchant: p.merchant ?? (p.isDebtPayment ? 'Pago de deuda' : null),
      note: p.suggestedInstallments ? `Sugerido: ${p.suggestedInstallments} cuotas` : null,
      occurred_at: raw.receivedAt, source: 'notification',
      payment_method: p.paymentMethod, status, dedupe_hash: result.dedupeHash,
      created_at: now, updated_at: now, deleted_at: null,
    });
    if (status === 'posted' && accountId) await adjustAccount(db, accountId, p.type === 'expense' ? -p.amount : p.amount);
    await log('imported', result.maskedText, result.dedupeHash, txId);
  });
  return 'imported';
}

/** Textos de ejemplo para probar el flujo completo sin esperar una notificación real. */
export const SIMULATED_NOTIFICATIONS: { label: string; packageName: string; text: string }[] = [
  { label: 'Tarjeta Nu · compra a cuotas', packageName: 'com.nu.production', text: 'Compra aprobada de $240.000 en ALKOSTO en 6 cuotas con tu tarjeta de crédito' },
  { label: 'Tarjeta Nu · compra sin cuotas dicho', packageName: 'com.nu.production', text: 'Compra aprobada de $85.000 en RAPPI COLOMBIA con tu tarjeta de crédito' },
  { label: 'Addi · compra', packageName: 'com.addi.app', text: 'Compraste $300.000 en Falabella con Addi' },
  { label: 'Nequi · gasto', packageName: 'com.nequi.MobileApp', text: 'Pagaste $18.500 en Tienda D1 con tu cuenta. Saldo $420.000' },
  { label: 'Nequi · OTP (debe descartarse)', packageName: 'com.nequi.MobileApp', text: 'Tu código de verificación es 482913. No lo compartas.' },
  { label: 'WhatsApp (debe ignorarse)', packageName: 'com.whatsapp', text: 'Hola, ¿cómo estás? $50.000' },
];

// ───────────── Bandeja de notificaciones no interpretadas ─────────────

export interface DraftNotification {
  id: string;
  source_package: string;
  masked_text: string;
  received_at: number;
}

/** Devuelve las notificaciones que el motor no pudo interpretar (para revisión manual). */
export async function listDrafts(): Promise<DraftNotification[]> {
  const db = await getDb();
  return db.getAllAsync<DraftNotification>(
    "SELECT id, source_package, masked_text, received_at FROM notifications_log WHERE outcome='discarded_unparsed' ORDER BY received_at DESC"
  );
}

/** Elimina un borrador de la bandeja. */
export async function deleteDraft(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM notifications_log WHERE id=?', [id]);
}

/** Borra TODOS los borradores de un solo golpe. */
export async function deleteAllDrafts(): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM notifications_log WHERE outcome='discarded_unparsed'");
}