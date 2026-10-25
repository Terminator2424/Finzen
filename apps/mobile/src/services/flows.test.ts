import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SOURCES } from '@finzen/core';
import { runMigrations, seedCategoriesSql } from '@finzen/db';

/**
 * Pruebas de integración de los flujos de dinero, ejecutando los servicios REALES de la app
 * contra SQLite real (node:sqlite) en vez de expo-sqlite. Solo se sustituyen getDb y expo-crypto.
 */
const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('./db', () => ({ getDb: async () => holder.db }));
let counter = 0;
vi.mock('expo-crypto', () => ({ randomUUID: () => `id-${++counter}` }));

const { DatabaseSync } = (process as any).getBuiltinModule('node:sqlite');

async function freshDb() {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const adapter = {
    runAsync: async (sql: string, p: any[] = []) => { raw.prepare(sql).run(...p); },
    getAllAsync: async (sql: string, p: any[] = []) => raw.prepare(sql).all(...p),
    getFirstAsync: async (sql: string, p: any[] = []) => raw.prepare(sql).get(...p) ?? null,
    execAsync: async (sql: string) => { raw.exec(sql); },
    withTransactionAsync: async (fn: () => Promise<unknown>) => {
      raw.exec('BEGIN');
      try { await fn(); raw.exec('COMMIT'); } catch (e) { raw.exec('ROLLBACK'); throw e; }
    },
  };
  await runMigrations({
    exec: async (s) => raw.exec(s),
    getUserVersion: async () => raw.prepare('PRAGMA user_version').get().user_version,
    setUserVersion: async (v) => raw.exec(`PRAGMA user_version = ${v}`),
  });
  raw.exec(seedCategoriesSql(1));
  for (const s of DEFAULT_SOURCES) {
    raw.prepare('INSERT INTO notification_sources (id,label,kind,package_pattern,enabled,user_added) VALUES (?,?,?,?,1,0)')
      .run(s.id, s.label, s.kind, s.packagePattern);
  }
  return adapter;
}

import { cardSummary, createDebt, deleteDebt, getDebt, getInstallments, listPlansOf, payCard, payInstallment } from './debts';
import { ingestNotification } from './notifications';
import { addAccount, getNetWorth, listAccounts } from './repo';
import {
  createInstallmentPurchase, createTransaction, deleteTransaction, listPending, monthTotals,
  resolvePendingWithPlan, spendingByCategory,
} from './transactions';
import { monthKey } from '@finzen/core';

const FIRST_DUE = '2026-11-15';

async function setup() {
  await addAccount({ name: 'Bancolombia ahorros', kind: 'savings', balance: 1_000_000, currency: 'COP' });
  const accountId = (await listAccounts())[0]!.id;
  const cardId = await createDebt({
    name: 'Nu', kind: 'credit_card', balance: 0, monthlyPayment: 0, annualRatePct: 28, dueDay: 25, cutDay: 10, creditLimit: 2_000_000,
  });
  return { accountId, cardId };
}

beforeEach(async () => { holder.db = await freshDb(); });

describe('tarjeta de crédito', () => {
  it('compra a 1 pago suma al saldo de la tarjeta y reduce el cupo', async () => {
    const { cardId } = await setup();
    await createTransaction({ type: 'expense', amount: 150_000, merchant: 'Rappi', categoryId: 'cat_comida_domicilio', paymentMethod: 'credit', cardId });
    const card = (await getDebt(cardId))!;
    expect(card.balance).toBe(150_000);
    const s = await cardSummary(card);
    expect(s.used).toBe(150_000);
    expect(s.available).toBe(1_850_000);
  });

  it('compra a cuotas crea un plan hijo; el saldo rotativo no cambia pero el cupo sí', async () => {
    const { cardId } = await setup();
    const r = await createInstallmentPurchase(
      { type: 'expense', amount: 600_000, merchant: 'Alkosto', categoryId: 'cat_compras', paymentMethod: 'credit' },
      { name: 'Alkosto', provider: 'Nu', parentDebtId: cardId, installments: 6, mode: { kind: 'ea', eaPct: 28 }, firstDueDate: FIRST_DUE },
    );
    const plans = await listPlansOf(cardId);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.id).toBe(r.planId);
    expect(plans[0]!.parent_debt_id).toBe(cardId);
    expect((await getInstallments(r.planId))).toHaveLength(6);

    const card = (await getDebt(cardId))!;
    expect(card.balance).toBe(0);
    expect((await cardSummary(card)).used).toBe(600_000);
    // El patrimonio cuenta el plan una sola vez (no se duplica con la tarjeta)
    expect((await getNetWorth()).liabilities).toBe(600_000);
  });

  it('pagar una cuota baja el saldo del plan, descuenta de la cuenta y registra el pago', async () => {
    const { cardId, accountId } = await setup();
    const r = await createInstallmentPurchase(
      { type: 'expense', amount: 300_000, merchant: 'Falabella', categoryId: 'cat_compras', paymentMethod: 'credit' },
      { name: 'Falabella', provider: null, parentDebtId: cardId, installments: 3, mode: { kind: 'zero', feePerInstallment: 0 }, firstDueDate: FIRST_DUE },
    );
    const insts = await getInstallments(r.planId);
    await payInstallment(insts[0]!.id, accountId);

    expect((await getDebt(r.planId))!.balance).toBe(300_000 - insts[0]!.principal);
    expect((await listAccounts())[0]!.balance).toBe(1_000_000 - insts[0]!.total);

    // Pagar de nuevo la misma cuota no hace nada (idempotente)
    await payInstallment(insts[0]!.id, accountId);
    expect((await listAccounts())[0]!.balance).toBe(1_000_000 - insts[0]!.total);

    await payInstallment(insts[1]!.id, accountId);
    await payInstallment(insts[2]!.id, accountId);
    const plan = (await getDebt(r.planId))!;
    expect(plan.balance).toBe(0);
    expect(plan.status).toBe('paid');
  });

  it('pagar la tarjeta reduce el saldo rotativo y no baja de 0', async () => {
    const { cardId, accountId } = await setup();
    await createTransaction({ type: 'expense', amount: 100_000, merchant: 'X', categoryId: 'cat_otros', paymentMethod: 'credit', cardId });
    await payCard(cardId, 250_000, accountId);
    expect((await getDebt(cardId))!.balance).toBe(0);
  });

  it('eliminar una compra a 1 pago revierte el saldo; una de cuotas no se deja eliminar suelta', async () => {
    const { cardId } = await setup();
    const single = await createTransaction({ type: 'expense', amount: 80_000, merchant: 'X', categoryId: 'cat_otros', paymentMethod: 'credit', cardId });
    expect(await deleteTransaction(single)).toBe(true);
    expect((await getDebt(cardId))!.balance).toBe(0);

    const plan = await createInstallmentPurchase(
      { type: 'expense', amount: 90_000, merchant: 'Y', categoryId: 'cat_otros', paymentMethod: 'credit' },
      { name: 'Y', provider: null, parentDebtId: cardId, installments: 3, mode: { kind: 'zero', feePerInstallment: 0 }, firstDueDate: FIRST_DUE },
    );
    expect(await deleteTransaction(plan.txId)).toBe(false);
    await deleteDebt(cardId); // borra la tarjeta y sus planes
    expect(await listPlansOf(cardId)).toHaveLength(0);
  });
});

describe('cuentas y reportes', () => {
  it('gasto/ingreso con cuenta ajustan el saldo; eliminar lo revierte', async () => {
    const { accountId } = await setup();
    const g = await createTransaction({ type: 'expense', amount: 40_000, merchant: 'D1', categoryId: 'cat_comida_mercado', accountId, paymentMethod: 'debit' });
    await createTransaction({ type: 'income', amount: 500_000, merchant: 'Salario', categoryId: 'cat_ingreso_salario', accountId });
    expect((await listAccounts())[0]!.balance).toBe(1_460_000);
    await deleteTransaction(g);
    expect((await listAccounts())[0]!.balance).toBe(1_500_000);
  });

  it('los pagos de deuda no cuentan como gasto ni en la dona; subcategorías suman en su padre', async () => {
    const { cardId, accountId } = await setup();
    await createTransaction({ type: 'expense', amount: 30_000, merchant: 'Rappi', categoryId: 'cat_comida_domicilio', accountId });
    await createTransaction({ type: 'expense', amount: 20_000, merchant: 'Mercado', categoryId: 'cat_comida_mercado', accountId });
    await createTransaction({ type: 'expense', amount: 100_000, merchant: 'X', categoryId: 'cat_otros', paymentMethod: 'credit', cardId });
    await payCard(cardId, 100_000, accountId);

    const m = monthKey();
    const totals = await monthTotals(m);
    expect(totals.expense).toBe(150_000);
    expect(totals.debtPayments).toBe(100_000);

    const spend = await spendingByCategory(m);
    expect(spend.find((s) => s.categoryId === 'cat_comida')!.total).toBe(50_000);
    expect(spend.some((s) => s.categoryId === 'cat_deudas')).toBe(false);
  });
});

describe('notificaciones → compra pendiente → cuotas', () => {
  const nu = { packageName: 'com.nu.production', text: 'Compra aprobada de $240.000 en ALKOSTO en 6 cuotas con tu tarjeta de crédito' };

  it('flujo completo con la tarjeta Nu', async () => {
    const { cardId } = await setup();
    expect(await ingestNotification({ ...nu, receivedAt: 1_760_000_000_000 })).toBe('imported');

    const pending = await listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ amount: 240_000, merchant: 'ALKOSTO', status: 'needs_installments' });
    expect(pending[0]!.note).toContain('6 cuotas');
    // Pendiente: todavía no mueve la tarjeta ni el patrimonio
    expect((await getDebt(cardId))!.balance).toBe(0);
    expect((await getNetWorth()).liabilities).toBe(0);

    await resolvePendingWithPlan(pending[0]!.id, {
      name: 'ALKOSTO', provider: 'Nu', parentDebtId: cardId, installments: 6, mode: { kind: 'ea', eaPct: 28 }, firstDueDate: FIRST_DUE,
    });
    expect(await listPending()).toHaveLength(0);
    expect((await listPlansOf(cardId))[0]!.installments_total).toBe(6);
    expect((await getNetWorth()).liabilities).toBe(240_000);
  });

  it('la misma notificación dos veces no duplica la transacción', async () => {
    await setup();
    await ingestNotification({ ...nu, receivedAt: 1_760_000_000_000 });
    expect(await ingestNotification({ ...nu, receivedAt: 1_760_000_005_000 })).toBe('duplicate');
    expect(await listPending()).toHaveLength(1);
  });

  it('OTP y apps ajenas se descartan sin guardar nada', async () => {
    await setup();
    expect(await ingestNotification({ packageName: 'com.nequi.MobileApp', text: 'Tu código de verificación es 482913', receivedAt: Date.now() })).toBe('discarded_otp');
    expect(await ingestNotification({ packageName: 'com.whatsapp', text: 'Compraste $5.000', receivedAt: Date.now() })).toBe('discarded_not_whitelisted');
    const rows = holder.db as any;
    expect((await rows.getAllAsync('SELECT * FROM transactions'))).toHaveLength(0);
    const log = await rows.getAllAsync('SELECT masked_text, outcome FROM notifications_log');
    expect(log).toEqual([{ masked_text: null, outcome: 'discarded_otp' }]);
  });

  it('un gasto de Nequi se asocia a la cuenta llamada Nequi y baja su saldo', async () => {
    await addAccount({ name: 'Nequi', kind: 'wallet', balance: 100_000, currency: 'COP' });
    await ingestNotification({ packageName: 'com.nequi.MobileApp', text: 'Pagaste $18.500 en Tienda D1 con tu cuenta', receivedAt: 5 });
    expect((await listAccounts())[0]!.balance).toBe(81_500);
  });
});

describe('seguridad de la lectura de notificaciones', () => {
  const nequi = (pkg: string, text = 'Pagaste $9.000 en Tienda X con tu cuenta') => ({ packageName: pkg, text, receivedAt: Date.now() });

  it('una app impostora con nombre parecido (com.evil.nequi) se ignora tras anclar el paquete real', async () => {
    await setup();
    expect(await ingestNotification(nequi('com.nequi.MobileApp'))).toBe('imported');
    const spoof = await ingestNotification({ ...nequi('com.evil.nequi', 'Pagaste $77.000 en Estafa SAS con tu cuenta'), receivedAt: Date.now() + 120_000 });
    expect(spoof).toBe('discarded_not_whitelisted');
    const db = holder.db as any;
    expect((await db.getAllAsync("SELECT * FROM transactions WHERE merchant LIKE '%Estafa%'"))).toHaveLength(0);
    const log = await db.getAllAsync("SELECT source_package, masked_text FROM notifications_log WHERE source_package='com.evil.nequi'");
    expect(log).toEqual([{ source_package: 'com.evil.nequi', masked_text: null }]); // queda constancia SIN texto
  });

  it('el paquete anclado sigue funcionando', async () => {
    await setup();
    await ingestNotification(nequi('com.nequi.MobileApp'));
    expect(await ingestNotification({ ...nequi('com.nequi.MobileApp', 'Pagaste $1.500 en Otra Tienda con tu cuenta'), receivedAt: Date.now() + 120_000 })).toBe('imported');
  });

  it('la bitácora se poda: nada de más de 30 días', async () => {
    await setup();
    const db = holder.db as any;
    const old = Date.now() - 40 * 86_400_000;
    await db.runAsync("INSERT INTO notifications_log (id,source_package,received_at,masked_text,outcome) VALUES ('old1','com.x',?,'viejo','imported')", [old]);
    await ingestNotification(nequi('com.nequi.MobileApp'));
    expect(await db.getAllAsync("SELECT id FROM notifications_log WHERE id='old1'")).toHaveLength(0);
  });
});
