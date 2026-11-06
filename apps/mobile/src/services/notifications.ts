import { processNotification, type NotificationSource, type RawNotification } from '@finzen/core';
import { getDb } from './db';
import { adjustAccount, getSetting, patchRow, uid, writeRow } from './repo';
import { SMS_PACKAGES } from './senderRules';
import { payInstallment } from './debts';
import { findAccountForApp, findCardsForApp, registerDebtPayment, suggestCategory, tryPairTransfer } from './transactions';

/**
 * Recibe una notificación cruda (de Android o del simulador), la pasa por el pipeline de
 * seguridad de @finzen/core y guarda el resultado. El texto original NO se guarda nunca:
 * solo la versión enmascarada, y nada si fue OTP o de una app fuera de la lista blanca.
 */
export type IngestOutcome = 'imported' | 'duplicate' | 'discarded_otp' | 'discarded_not_whitelisted' | 'discarded_unparsed' | 'bill_saved';
/** Lo que admite la columna notifications_log.outcome. */
type LoggedOutcome = Exclude<IngestOutcome, 'bill_saved'>;

async function loadSources(): Promise<NotificationSource[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; label: string; kind: 'bank' | 'wallet' | 'bnpl'; package_pattern: string }>(
    'SELECT id,label,kind,package_pattern FROM notification_sources WHERE enabled=1',
  );
  return rows.map((r) => ({ id: r.id, label: r.label, kind: r.kind, packagePattern: r.package_pattern }));
}

const LOG_DAYS = 7;
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
  const log = (outcome: LoggedOutcome, maskedText: string | null, hash: string | null, txId: string | null) =>
    db.runAsync(
      'INSERT INTO notifications_log (id,source_package,received_at,masked_text,text_hash,outcome,transaction_id) VALUES (?,?,?,?,?,?,?)',
      [logId, raw.packageName, raw.receivedAt, maskedText, hash, outcome, txId],
    );

  if (result.outcome === 'discarded_not_whitelisted') {
    // Ni siquiera se registra el paquete: no queremos un historial de qué apps usa la persona.
    return 'discarded_not_whitelisted';
  }
  if (result.outcome === 'discarded_otp') { await log('discarded_otp', null, null, null); return 'discarded_otp'; }
  if (result.outcome === 'discarded_unparsed') {
    // SMS: casi todo lo que no se entiende es publicidad; no llenamos Borradores con eso.
    if (SMS_PACKAGES.has(raw.packageName)) return 'discarded_unparsed';
    await log('discarded_unparsed', result.maskedText, null, null);
    return 'discarded_unparsed';
  }

  // ¿El paquete es el verdadero de esa fuente? Si no, se ignora y se deja constancia (sin texto).
  if (!(await checkBinding(db, result.sourceId, raw.packageName))) {
    await log('discarded_not_whitelisted', null, null, null);
    return 'discarded_not_whitelisted';
  }

  // Aviso de factura por pagar (p. ej. SMS de Tigo): no es un gasto, se guarda como pago recurrente.
  if (result.outcome === 'bill') {
    // Solo facturas de remitentes conocidos (SMS/WhatsApp); otras (p. ej. un extracto) van a Borradores.
    if (!raw.senderKey) {
      await log('discarded_unparsed', result.maskedText, null, null);
      return 'discarded_unparsed';
    }
    const seenBill = await db.getFirstAsync<{ id: string }>('SELECT id FROM notifications_log WHERE text_hash=?', [result.dedupeHash]);
    if (seenBill) { await log('duplicate', result.maskedText, result.dedupeHash, null); return 'duplicate'; }
    const billName = raw.senderKey.charAt(0).toUpperCase() + raw.senderKey.slice(1);
    const billCategory = await suggestCategory(billName);
    const billDay = result.bill.dueDate ? Number(result.bill.dueDate.slice(8, 10)) : new Date(raw.receivedAt).getDate();
    const billNow = Date.now();
    await db.withTransactionAsync(async () => {
      const existing = await db.getFirstAsync<{ id: string }>(
        'SELECT id FROM recurring_expenses WHERE lower(name)=lower(?) AND deleted_at IS NULL', [billName],
      );
      if (existing) {
        await patchRow(db, 'recurring_expenses', existing.id, { amount: result.bill.amount, day_of_month: billDay, is_active: 1 });
      } else {
        await writeRow(db, 'recurring_expenses', {
          id: uid(), name: billName, amount: result.bill.amount, day_of_month: billDay, category_id: billCategory,
          is_active: 1, created_at: billNow, updated_at: billNow, deleted_at: null,
        });
      }
      await log('imported', result.maskedText, result.dedupeHash, null);
    });
    return 'bill_saved';
  }

  const dup = await db.getFirstAsync<{ id: string }>('SELECT id FROM transactions WHERE dedupe_hash=?', [result.dedupeHash]);
  if (dup) { await log('duplicate', result.maskedText, result.dedupeHash, dup.id); return 'duplicate'; }

  const p = result.parsed;

  // Pago de tarjeta de crédito (p. ej. Nu: "Pagaste tu tarjeta de crédito").
  if (p.isCardPayment) {
    const cards = await findCardsForApp(raw.packageName);
    if (cards.length === 1) {
      // Una sola tarjeta calza con la app: se abona sola y se descuenta de la cuenta de esa app (si hay una).
      const paidTx = await registerDebtPayment({
        debtId: cards[0]!.id, amount: p.amount, accountId: await findAccountForApp(raw.packageName),
        occurredAt: raw.receivedAt, source: 'notification', dedupeHash: result.dedupeHash,
      });
      await log('imported', result.maskedText, result.dedupeHash, paidTx);
      return 'imported';
    }
    // 0 o varias tarjetas posibles: no se adivina. Va a Borradores y "Procesar" abre el formulario de abono a deuda.
    const seenDraft = await db.getFirstAsync<{ id: string }>('SELECT id FROM notifications_log WHERE text_hash=?', [result.dedupeHash]);
    if (seenDraft) { await log('duplicate', result.maskedText, result.dedupeHash, null); return 'duplicate'; }
    await log('discarded_unparsed', result.maskedText, result.dedupeHash, null);
    return 'discarded_unparsed';
  }

  if (p.isDebtPayment && !p.isCardPayment) {
    // Pago de una cuota (Addi, Sistecrédito…): se busca una cuota pendiente con ESE valor.
    const seenPay = await db.getFirstAsync<{ id: string }>('SELECT id FROM notifications_log WHERE text_hash=?', [result.dedupeHash]);
    if (seenPay) { await log('duplicate', result.maskedText, result.dedupeHash, null); return 'duplicate'; }
    const cand = await db.getAllAsync<{ id: string; debt_id: string }>(
      `SELECT i.id, i.debt_id FROM debt_installments i JOIN debts d ON d.id=i.debt_id
        WHERE i.paid_at IS NULL AND i.deleted_at IS NULL AND d.deleted_at IS NULL AND d.status='active' AND i.total=?
        ORDER BY i.due_date, i.number`,
      [p.amount],
    );
    if (cand.length >= 1) {
      // Todas son de la misma deuda: se paga la más próxima. De deudas distintas: no se adivina.
      if (new Set(cand.map((c) => c.debt_id)).size === 1) {
        await payInstallment(cand[0]!.id, await findAccountForApp(raw.packageName));
        await log('imported', result.maskedText, result.dedupeHash, null);
        return 'imported';
      }
      await log('discarded_unparsed', result.maskedText, result.dedupeHash, null);
      return 'discarded_unparsed';
    }
  }

  const source = sources.find((s) => s.id === result.sourceId);
  const now = Date.now();
  const txId = uid();
  const categoryId = p.isDebtPayment ? 'cat_deudas' : p.type === 'income' ? 'cat_ingreso_otros' : p.merchant ? await suggestCategory(p.merchant) : null;
  const status = p.needsInstallments ? 'needs_installments' : 'posted';

  // Cuenta asociada: la que se llame como la fuente o, si no, como la app (app "com.nu.production" -> cuenta "Nu").
  let accountId: string | null = null;
  if (!p.needsInstallments && p.paymentMethod !== 'credit' && source) {
    const acc = await db.getFirstAsync<{ id: string }>(
      "SELECT id FROM accounts WHERE deleted_at IS NULL AND archived=0 AND lower(name) LIKE '%' || lower(?) || '%' LIMIT 1",
      [source.label],
    );
    accountId = acc?.id ?? (await findAccountForApp(raw.packageName));
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
    if (status === 'posted' && accountId) {
      await adjustAccount(db, accountId, p.type === 'expense' ? -p.amount : p.amount);
      // ¿Es la otra mitad de una transferencia entre tus propias cuentas (Nu ⇄ Nequi)?
      await tryPairTransfer(db, { id: txId, type: p.type, amount: p.amount, accountId, at: raw.receivedAt, text: result.maskedText, selfName: (await getSetting('owner_name')) ?? null });
    }
    await log('imported', result.maskedText, result.dedupeHash, txId);
  });
  return 'imported';
}

/** Textos de ejemplo para probar el flujo completo sin esperar una notificación real. */
export const SIMULATED_NOTIFICATIONS: { label: string; packageName: string; text: string }[] = [
  { label: 'Nu · pago de tarjeta', packageName: 'com.nu.production', text: '¡Bravo! Pagaste tu tarjeta de crédito Nu Recibimos tu pago por $50.000. En un rato podrás verlo en tu app.' },
  { label: 'Nequi · ingreso por Bre-B', packageName: 'com.nequi.MobileApp', text: 'Te enviaron plata por Bre-B Te enviaron $10. Entra a tu app y revisa tu saldo.' },
  { label: 'SMS Tigo · factura', packageName: 'com.google.android.apps.messages', text: 'Ya generamos tu factura de OCTUBRE, linea 3001234567 por $19,900, limite de pago 21/11/2026. Pagala facil en b.tigo.com/XXXXXXXXXX Tigo' },
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