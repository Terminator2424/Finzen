import { describe, expect, it } from 'vitest';
import { processNotification } from './pipeline';
import { TEST_SOURCES } from './testSources';

const T = 1_760_000_000_000;
const run = (packageName: string, title: string, text: string) =>
  processNotification({ packageName, title, text, receivedAt: T }, TEST_SOURCES);

describe('notificaciones reales (nov 2026)', () => {
  it('Nu: "Enviaste $1,00" es un gasto de 1 peso', () => {
    const r = run('com.nu.production', 'Enviaste $1,00', 'Le enviaste a EDI***** JAV***** GON******* VEL***** en su cuenta');
    expect(r.outcome).toBe('imported');
    if (r.outcome !== 'imported') return;
    expect(r.parsed).toMatchObject({ type: 'expense', amount: 1, isDebtPayment: false, merchant: null });
  });

  it('Nequi: "Te enviaron $10" por Bre-B es un ingreso', () => {
    const r = run('com.nequi.MobileApp', 'Te enviaron plata por Bre-B', 'Te enviaron $10. Entra a tu app y revisa tu saldo.');
    expect(r.outcome).toBe('imported');
    if (r.outcome !== 'imported') return;
    expect(r.parsed).toMatchObject({ type: 'income', amount: 10, paymentMethod: 'debit', merchant: null });
  });

  it('Nu: el pago de la tarjeta de credito se reconoce como abono a la tarjeta', () => {
    // Texto real. El monto real fue $0,02; aqui se usa otro porque el motor trabaja en pesos enteros.
    const r = run('com.nu.production', '¡Bravo! Pagaste tu tarjeta de crédito Nu', 'Recibimos tu pago por $50.000. En un rato podrás verlo en tu app.');
    expect(r.outcome).toBe('imported');
    if (r.outcome !== 'imported') return;
    expect(r.parsed).toMatchObject({
      type: 'expense', amount: 50_000, isDebtPayment: true, isCardPayment: true, needsInstallments: false, merchant: null,
    });
  });

  it('montos menores a un peso se descartan (el motor trabaja en pesos enteros)', () => {
    const r = run('com.nu.production', '¡Bravo! Pagaste tu tarjeta de crédito Nu', 'Recibimos tu pago por $0,02. En un rato podrás verlo en tu app.');
    expect(r.outcome).toBe('discarded_unparsed');
  });
});

describe('casos sinteticos', () => {
  it('Nequi: "Transferiste $20.000 por Bre-B" es un gasto, no un ingreso', () => {
    const r = run('com.nequi.MobileApp', '', 'Transferiste $20.000 por Bre-B');
    expect(r.outcome).toBe('imported');
    if (r.outcome !== 'imported') return;
    expect(r.parsed).toMatchObject({ type: 'expense', amount: 20_000, paymentMethod: 'debit' });
  });
});