import { describe, expect, it } from 'vitest';
import { processNotification } from './pipeline';
import type { NotificationSource } from './sources';

const WA: NotificationSource[] = [
  { id: 'wa', label: 'WhatsApp', kind: 'bank', packagePattern: '^com\\.whatsapp$' },
];
const T = 1_760_000_000_000;

describe('WhatsApp con remitente BNPL', () => {
  it('compra de Addi por WhatsApp pide cuotas', () => {
    const r = processNotification(
      { packageName: 'com.whatsapp', title: 'Addi', text: 'Compraste $300.000 en Falabella con Addi', receivedAt: T, senderKey: 'addi' },
      WA,
    );
    expect(r.outcome).toBe('imported');
    if (r.outcome !== 'imported') return;
    expect(r.parsed).toMatchObject({ paymentMethod: 'bnpl', needsInstallments: true, amount: 300_000 });
  });

  it('sin senderKey se trata con el tipo de la fuente', () => {
    const r = processNotification(
      { packageName: 'com.whatsapp', text: 'Compraste $300.000 en Falabella con Addi', receivedAt: T },
      WA,
    );
    expect(r.outcome).toBe('imported');
    if (r.outcome !== 'imported') return;
    expect(r.parsed.needsInstallments).toBe(false);
  });

  it('pagar una cuota de Sistecredito es pago de deuda, no pide cuotas', () => {
    const r = processNotification(
      { packageName: 'com.whatsapp', title: 'Sistecredito', text: 'Pagaste tu cuota de $53.558 en Sistecredito', receivedAt: T, senderKey: 'sistecredito' },
      WA,
    );
    expect(r.outcome).toBe('imported');
    if (r.outcome !== 'imported') return;
    expect(r.parsed).toMatchObject({ isDebtPayment: true, needsInstallments: false });
  });
});