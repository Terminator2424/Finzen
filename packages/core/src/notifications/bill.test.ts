import { describe, expect, it } from 'vitest';
import { parseBillNotice } from './bill';
import { processNotification } from './pipeline';
import type { NotificationSource } from './sources';

const SMS: NotificationSource[] = [
  { id: 'sms', label: 'SMS', kind: 'bank', packagePattern: '^com\\.google\\.android\\.apps\\.messages$' },
];
const T = 1_760_000_000_000;
// Formato real de Tigo; el numero de linea y el enlace son FALSOS.
const FACTURA = 'Ya generamos tu factura de OCTUBRE, linea 3001234567 por $19,900, limite de pago 21/11/2026. Pagala facil en b.tigo.com/XXXXXXXXXX Tigo';
const PROMO = 'Tu linea 3001234567 esta a un paso de tener: internet con fibra 900 Megas + celular ilimitado a $59.950 x 3 meses, luego $119.900. Llama 018000000000 TyC Tigo';

describe('parseBillNotice', () => {
  it('lee monto, periodo y fecha limite del SMS de Tigo', () => {
    expect(parseBillNotice(FACTURA)).toEqual({ amount: 19_900, dueDate: '2026-11-21', period: 'octubre' });
  });
  it('ignora la publicidad con montos', () => {
    expect(parseBillNotice(PROMO)).toBeNull();
  });
  it('no es factura por pagar si ya dice que pagaste', () => {
    expect(parseBillNotice('Pagaste tu factura de Tigo por $19.900')).toBeNull();
  });
});

describe('processNotification con facturas', () => {
  it('SMS de Tigo -> aviso de factura, con el celular enmascarado', () => {
    const r = processNotification(
      { packageName: 'com.google.android.apps.messages', title: 'TIGO', text: FACTURA, receivedAt: T, senderKey: 'tigo' },
      SMS,
    );
    expect(r.outcome).toBe('bill');
    if (r.outcome !== 'bill') return;
    expect(r.bill).toMatchObject({ amount: 19_900, dueDate: '2026-11-21' });
    expect(r.maskedText).not.toContain('3001234567');
  });
  it('la publicidad de Tigo no se guarda como gasto', () => {
    const r = processNotification(
      { packageName: 'com.google.android.apps.messages', title: 'TIGO', text: PROMO, receivedAt: T, senderKey: 'tigo' },
      SMS,
    );
    expect(r.outcome).toBe('discarded_unparsed');
  });
});