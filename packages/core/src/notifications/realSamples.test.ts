import { describe, expect, it } from 'vitest';
import { processNotification } from './pipeline';
import { TEST_SOURCES } from './testSources';
import type { NotificationSource } from './sources';

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

describe('Nequi: envíos de personas (nov 2026)', () => {
  it('"YOJHAN CETINA te envió 1" es un ingreso de 1 peso, aunque el título sea "Envío"', () => {
    const r = run('com.nequi.MobileApp', 'Envío', 'YOJHAN CETINA te envió 1, ¡lo mejor!');
    expect(r.outcome).toBe('imported');
    if (r.outcome !== 'imported') return;
    expect(r.parsed).toMatchObject({ type: 'income', amount: 1 });
  });
});

describe('BBVA, DaviPlata y avisos de Nu (nov 2026)', () => {
  const BANK: NotificationSource[] = [{ id: 'bank', label: 'Banco', kind: 'bank', packagePattern: '^com\\.test\\.bank$' }];
  const bank = (title: string, text: string) => processNotification({ packageName: 'com.test.bank', title, text, receivedAt: T }, BANK);

  it('BBVA: recibir por Bre-B es un ingreso', () => {
    const r = bank('Recibiste dinero en tu cuenta a través de Bre-B', '2026/11/08 18:26 KAROL NICOL ARENAS PENA te envío 1,00 a tu llave y el dinero ya está disponible en tu Cuenta BBVA. Si no reconoces la operación, comunícate al 01 8000 912 227.');
    expect(r.outcome).toBe('imported');
    if (r.outcome !== 'imported') return;
    expect(r.parsed).toMatchObject({ type: 'income', amount: 1 });
  });

  it('BBVA: enviar con llave es un gasto', () => {
    const r = bank('Tu envío con llave fue exitoso', '2026/11/08 18:33 KAROL ARENAS recibió el valor de $ 2.200,00 que enviaste a su llave *****5417 registrada en Nequi. Si no reconoces la operación, comunícate al 01 8000 912 227.');
    expect(r.outcome).toBe('imported');
    if (r.outcome !== 'imported') return;
    expect(r.parsed).toMatchObject({ type: 'expense', amount: 2200 });
  });

  it('BBVA: un pago rechazado no es un movimiento', () => {
    const r = bank('Pago rechazado', 'Hola, tu pago en Microsoft fue rechazado. Revisa tu saldo en la App BBVA o usa otro medio de pago. Tarjeta usada: *7095. Valor: $24,500.00. El 2026-10-23 a las 00:09.');
    expect(r.outcome).toBe('discarded_unparsed');
  });

  it('DaviPlata: "Pasaste $1 a ..." por Llaves es un gasto, no un ingreso', () => {
    const r = bank('DaviPlata', 'Transaccion exitosa: Pasaste $1 a Karol Arenas usando Llaves. Conoce mas desde los movimientos de tu DaviPlata.');
    expect(r.outcome).toBe('imported');
    if (r.outcome !== 'imported') return;
    expect(r.parsed).toMatchObject({ type: 'expense', amount: 1 });
  });

  it('DaviPlata: el aviso de recibir no trae monto y no se puede leer', () => {
    const r = bank('DaviPlata', 'Transaccion exitosa: Recibiste Plata de otra entidad usando Llaves, consulta el detalle de tus movimientos desde el app DaviPlata.');
    expect(r.outcome).toBe('discarded_unparsed');
  });

  it('Nu: "Tienes un pago por ... Completa tu pago" no es un movimiento', () => {
    const r = run('com.nu.production', 'Tienes un pago por $123.083,30 de P.A. ADDI', 'Completa tu pago de forma fácil y segura en tu app Nu.');
    expect(r.outcome).toBe('discarded_unparsed');
  });

  it('Nu: "Pago aprobado" por PSE es un gasto de 123.083', () => {
    const r = run('com.nu.production', 'Nu', 'Pago aprobado por $123.083,30 Pagaste en P.A. ADDI con tu cuenta de ahorros. Si tienes dudas contáctanos via chat.');
    expect(r.outcome).toBe('imported');
    if (r.outcome !== 'imported') return;
    expect(r.parsed).toMatchObject({ type: 'expense', amount: 123_083 });
  });

  it('Nu: enviar a Nequi y recibir por llave', () => {
    const a = run('com.nu.production', 'Enviaste $600,00', 'Le enviaste a DAN**** GON******* en su cuenta de Nequi S.A. CF.');
    expect(a.outcome).toBe('imported');
    if (a.outcome === 'imported') expect(a.parsed).toMatchObject({ type: 'expense', amount: 600 });
    const b = run('com.nu.production', 'Recibiste 100.000,00 en tu cuenta', 'Te llegó dinero de PRACTISISTEMAS SAS con tu llave.');
    expect(b.outcome).toBe('imported');
    if (b.outcome === 'imported') expect(b.parsed).toMatchObject({ type: 'income', amount: 100_000 });
  });
});