import { payInstallment } from './debts';
import { adjustAccount, patchRow, type Db } from './repo';
import { findAccountForApp } from './transactions';

type Outcome = 'imported' | 'duplicate' | 'discarded_unparsed';
type LogFn = (outcome: Outcome, maskedText: string | null, hash: string | null, txId: string | null) => Promise<unknown>;
export interface PaymentLike { amount: number; type: 'expense' | 'income'; isDebtPayment: boolean; isCardPayment: boolean }

const PAID_WORDS = /pagaste|pago\s+aprobado|pago\s+exitoso|pago\s+recibido/i;
const SIX_HOURS = 6 * 3_600_000;

/**
 * ¿El aviso es el pago de una cuota? Casos: "Pagaste tu cuota de $X" y el aviso del banco por PSE
 * ("Pago aprobado por $X ... Pagaste en P.A. ADDI"). La cuota se busca por su valor (±1 peso); si el aviso nombra al proveedor
 * de una deuda (Addi, Sistecrédito...), la búsqueda se limita a esas deudas. Así no se registra un gasto suelto: baja la deuda
 * y se descuenta de la cuenta del banco. Devuelve null si no es el pago de una cuota (el flujo normal sigue).
 */
export async function payInstallmentFromNotification(
  db: Db, raw: { packageName: string; receivedAt: number }, maskedText: string, hash: string, p: PaymentLike, log: LogFn,
): Promise<Outcome | null> {
  if (p.isCardPayment || p.type !== 'expense') return null;
  const lower = maskedText.toLowerCase();
  const providers = await db.getAllAsync<{ id: string; provider: string }>(
    "SELECT id, provider FROM debts WHERE deleted_at IS NULL AND status='active' AND provider IS NOT NULL AND length(provider) >= 3",
  );
  const named = providers.filter((d) => lower.includes(d.provider.toLowerCase())).map((d) => d.id);
  if (!p.isDebtPayment && !(named.length > 0 && PAID_WORDS.test(maskedText))) return null;

  const seen = await db.getFirstAsync<{ id: string }>('SELECT id FROM notifications_log WHERE text_hash=?', [hash]);
  if (seen) { await log('duplicate', maskedText, hash, null); return 'duplicate'; }

  const scope = named.length > 0 ? ` AND d.id IN (${named.map(() => '?').join(',')})` : '';
  const since = Date.now() - SIX_HOURS;

  // ¿Ese pago ya se contó hace poco (otro aviso del mismo pago)? No se paga dos veces.
  const recent = await db.getFirstAsync<{ debt_id: string }>(
    `SELECT i.debt_id FROM debt_installments i JOIN debts d ON d.id = i.debt_id
      WHERE i.paid_at IS NOT NULL AND i.paid_at >= ? AND ABS(i.total - ?) <= 1 AND d.deleted_at IS NULL${scope}
      ORDER BY i.paid_at DESC`,
    [since, p.amount, ...named],
  );
  if (recent) {
    // Si este aviso viene de un banco con cuenta y el pago anterior quedó sin cuenta, se descuenta de esa cuenta.
    const acc = await findAccountForApp(raw.packageName);
    if (acc) {
      const orphan = await db.getFirstAsync<{ id: string; amount: number }>(
        "SELECT id, amount FROM transactions WHERE deleted_at IS NULL AND category_id='cat_deudas' AND account_id IS NULL AND debt_id=? AND ABS(amount - ?) <= 1 AND created_at >= ? ORDER BY created_at DESC",
        [recent.debt_id, p.amount, since],
      );
      if (orphan) {
        await db.withTransactionAsync(async () => {
          await patchRow(db, 'transactions', orphan.id, { account_id: acc });
          await adjustAccount(db, acc, -orphan.amount);
        });
      }
    }
    await log('duplicate', maskedText, hash, null);
    return 'duplicate';
  }

  const cand = await db.getAllAsync<{ id: string; debt_id: string }>(
    `SELECT i.id, i.debt_id FROM debt_installments i JOIN debts d ON d.id = i.debt_id
      WHERE i.paid_at IS NULL AND i.deleted_at IS NULL AND d.deleted_at IS NULL AND d.status='active' AND ABS(i.total - ?) <= 1${scope}
      ORDER BY i.due_date, i.number`,
    [p.amount, ...named],
  );
  if (cand.length === 0) return null;
  // Todas de la misma deuda: se paga la más próxima. De deudas distintas: no se adivina.
  if (new Set(cand.map((c) => c.debt_id)).size > 1) { await log('discarded_unparsed', maskedText, hash, null); return 'discarded_unparsed'; }
  await payInstallment(cand[0]!.id, await findAccountForApp(raw.packageName));
  await log('imported', maskedText, hash, null);
  return 'imported';
}