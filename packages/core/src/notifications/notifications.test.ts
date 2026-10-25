import { describe, expect, it } from 'vitest';
import { parseCopAmount } from './parse';
import { processNotification } from './pipeline';
import { isOtp, maskSensitive } from './sanitize';
import { matchSource } from './sources';

const T = 1_760_000_000_000;

describe('parseCopAmount', () => {
  it.each([
    ['50.000', 50_000],
    ['1.250.000', 1_250_000],
    ['1.250.000,50', 1_250_001], // redondea al peso
    ['50,000.75', 50_001],
    ['50', 50],
    ['12,5', 13],
  ])('%s → %i', (raw, expected) => {
    expect(parseCopAmount(raw)).toBe(expected);
  });
});

describe('isOtp', () => {
  it.each([
    'Tu código de verificación es 483920',
    'Tu clave temporal es 1234, no la compartas',
    'OTP: 889123',
    'Nunca te pediremos tu clave. Código: 4455',
  ])('descarta: %s', (t) => expect(isOtp(t)).toBe(true));

  it('no marca una compra normal', () => {
    expect(isOtp('Compraste $50.000 en Rappi con tu tarjeta *1234')).toBe(false);
  });
});

describe('maskSensitive', () => {
  it('enmascara tarjetas dejando 4 dígitos', () => {
    expect(maskSensitive('Tarjeta 4111 1111 1111 1234')).toBe('Tarjeta ****1234');
    expect(maskSensitive('Cuenta 1234567890')).toBe('Cuenta ****7890');
  });

  it('enmascara celulares con y sin prefijo', () => {
    expect(maskSensitive('Enviaste a 300 123 4567')).toBe('Enviaste a ****4567');
    expect(maskSensitive('Enviaste a +57 3001234567')).toBe('Enviaste a ****4567');
  });

  it('enmascara correos', () => {
    expect(maskSensitive('Enviado a juan.perez@gmail.com')).toBe('Enviado a j***@gmail.com');
  });

  it('NO toca los montos', () => {
    const t = 'Compraste $1.250.000 y $50.000, saldo $9.876.543,21';
    expect(maskSensitive(t)).toBe(t);
    expect(maskSensitive('Pagaste $1234567890')).toBe('Pagaste $1234567890');
  });
});

describe('matchSource', () => {
  it('daviplata gana sobre davivienda', () => {
    expect(matchSource('com.davivienda.daviplataapp')?.id).toBe('daviplata');
  });
  it('ignora apps no listadas', () => {
    expect(matchSource('com.whatsapp')).toBeNull();
  });
});

describe('processNotification', () => {
  it('descarta apps fuera de la lista blanca sin leer el contenido', () => {
    expect(processNotification({ packageName: 'com.whatsapp', text: 'Compraste $5.000', receivedAt: T })).toEqual({
      outcome: 'discarded_not_whitelisted',
    });
  });

  it('descarta OTP de una app permitida y no devuelve texto', () => {
    const r = processNotification({ packageName: 'com.nequi.MobileApp', text: 'Tu código de verificación es 123456', receivedAt: T });
    expect(r).toEqual({ outcome: 'discarded_otp', sourceId: 'nequi' });
    expect(JSON.stringify(r)).not.toContain('123456');
  });

  it('importa un gasto con débito', () => {
    const r = processNotification({
      packageName: 'com.nequi.MobileApp',
      text: 'Pagaste $50.000 en RAPPI COLOMBIA con tu cuenta de ahorros. Saldo $1.200.000',
      receivedAt: T,
    });
    expect(r.outcome).toBe('imported');
    if (r.outcome !== 'imported') return;
    expect(r.parsed).toMatchObject({
      type: 'expense', amount: 50_000, merchant: 'RAPPI COLOMBIA', paymentMethod: 'debit', needsInstallments: false,
    });
  });

  it('ignora el saldo al elegir el monto', () => {
    const r = processNotification({
      packageName: 'com.nequi.MobileApp', text: 'Saldo disponible $900.000. Compraste $20.000 en Tienda D1', receivedAt: T,
    });
    expect(r.outcome === 'imported' && r.parsed.amount).toBe(20_000);
  });

  it('compra en Addi → pide cuotas', () => {
    const r = processNotification({
      packageName: 'com.addi.app', text: 'Compraste $300.000 en Falabella con Addi', receivedAt: T,
    });
    expect(r.outcome).toBe('imported');
    if (r.outcome !== 'imported') return;
    expect(r.parsed).toMatchObject({ paymentMethod: 'bnpl', needsInstallments: true, amount: 300_000 });
  });

  it('pagar una cuota de Addi NO pide cuotas (es pago de deuda)', () => {
    const r = processNotification({
      packageName: 'com.addi.app', text: 'Pagaste tu cuota de $53.558 en Addi', receivedAt: T,
    });
    expect(r.outcome === 'imported' && r.parsed.isDebtPayment).toBe(true);
    expect(r.outcome === 'imported' && r.parsed.needsInstallments).toBe(false);
  });

  it('tarjeta de crédito Nu con cuotas ya indicadas', () => {
    const r = processNotification({
      packageName: 'com.nu.production', text: 'Compra aprobada de $240.000 en ALKOSTO en 6 cuotas con tu tarjeta de crédito', receivedAt: T,
    });
    expect(r.outcome).toBe('imported');
    if (r.outcome !== 'imported') return;
    expect(r.parsed).toMatchObject({
      paymentMethod: 'credit', needsInstallments: true, suggestedInstallments: 6, merchant: 'ALKOSTO',
    });
  });

  it('detecta ingresos', () => {
    const r = processNotification({
      packageName: 'com.nequi.MobileApp', text: 'Recibiste $120.000 de Juan', receivedAt: T,
    });
    expect(r.outcome === 'imported' && r.parsed.type).toBe('income');
  });

  it('el texto guardado va enmascarado', () => {
    const r = processNotification({
      packageName: 'com.nequi.MobileApp', text: 'Enviaste $10.000 al 300 123 4567', receivedAt: T,
    });
    expect(r.outcome === 'imported' && r.maskedText).toContain('****4567');
    expect(r.outcome === 'imported' && r.maskedText).not.toContain('300 123');
  });

  it('la misma notificación en el mismo minuto da el mismo hash', () => {
    const n = { packageName: 'com.nequi.MobileApp', text: 'Pagaste $5.000 en Tienda', receivedAt: T };
    const a = processNotification(n);
    const b = processNotification({ ...n, receivedAt: T + 10_000 });
    expect(a.outcome === 'imported' && b.outcome === 'imported' && a.dedupeHash === b.dedupeHash).toBe(true);
  });

  it('texto sin monto reconocible → discarded_unparsed', () => {
    const r = processNotification({ packageName: 'com.nequi.MobileApp', text: 'Bienvenido a Nequi', receivedAt: T });
    expect(r.outcome).toBe('discarded_unparsed');
  });
});
