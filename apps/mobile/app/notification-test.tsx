import React, { useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { processNotification } from '@finzen/core';
import { AppText, Button, Card, Field, ScreenHeader } from '../src/components/ui';
import { SIMULATED_NOTIFICATIONS, ingestNotification, type IngestOutcome } from '../src/services/notifications';
import { SENDER_RULES } from '../src/services/senderRules';
import { useTheme } from '../src/theme/ThemeProvider';

const OUTCOME_TEXT: Record<IngestOutcome, string> = {
  imported: '✅ Registrada: ya aparece en Movimientos (o en la deuda).',
  bill_saved: '🧾 Factura guardada como pago recurrente.',
  duplicate: 'Ya se había registrado una igual.',
  discarded_otp: '🔒 Descartada: parece un código o clave.',
  discarded_not_whitelisted: 'Descartada: esa app no está en tu lista de fuentes (o no es el paquete vinculado).',
  discarded_unparsed: 'No quedó registrada sola: va a Borradores para revisarla a mano (los SMS no entendidos se ignoran).',
};

export default function NotificationTest() {
  const { colors } = useTheme();
  const [text, setText] = useState('');
  const [pkg, setPkg] = useState('com.nu.production');

  const run = () => {
    const kind = /addi|sistecredito/i.test(pkg) ? 'bnpl' : 'bank';
    const r = processNotification(
      { packageName: pkg, text, receivedAt: Date.now() },
      [{ id: 'prueba', label: 'Prueba', kind, packagePattern: '.' }],
    );
    if (r.outcome === 'discarded_otp') {
      Alert.alert('🔒 Descartada por seguridad', 'Parece un código o clave (OTP). La app la descarta sin guardar nada.');
      return;
    }
    if (r.outcome === 'discarded_unparsed') {
      Alert.alert('❌ No reconocida', `No se encontró un monto o no se entendió si es gasto o ingreso.\n\nTexto enmascarado:\n${r.maskedText}`);
      return;
    }
    if (r.outcome === 'bill') {
      Alert.alert(
        '🧾 Factura por pagar',
        `Monto: $${r.bill.amount}\nVence: ${r.bill.dueDate ?? 'sin fecha'}\nPeriodo: ${r.bill.period ?? 'no indicado'}\n\nSe registraría como pago recurrente, no como gasto.`,
      );
      return;
    }
    if (r.outcome !== 'imported') return;
    const p = r.parsed;
    Alert.alert(
      '✅ Interpretada',
      `Tipo: ${p.type === 'income' ? 'Ingreso (suma)' : 'Gasto (resta)'}\n` +
      `Monto: $${p.amount}\n` +
      `Comercio: ${p.merchant ?? 'No detectado'}\n` +
      `Método: ${p.paymentMethod}\n` +
      `¿Pago de deuda?: ${p.isDebtPayment ? 'Sí' : 'No'}\n` +
      `¿Pago de tarjeta?: ${p.isCardPayment ? 'Sí' : 'No'}\n` +
      `¿Pide cuotas?: ${p.needsInstallments ? 'Sí' : 'No'}\n\n` +
      `Texto enmascarado:\n${r.maskedText}`,
    );
  };

  const runReal = () => {
    Alert.alert(
      'Registrar de verdad',
      'Procesa el texto como si fuera una notificación real: si la app está en tu lista de fuentes, se crea el movimiento (o el abono a la tarjeta). ¿Continuar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Continuar',
          onPress: async () => {
            const out = await ingestNotification({ packageName: pkg.trim(), text, receivedAt: Date.now(), senderKey: SENDER_RULES[pkg.trim()]?.[0] });
            Alert.alert('Resultado', OUTCOME_TEXT[out]);
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
        <ScreenHeader title="Probar notificaciones" />
        <Card style={{ borderColor: colors.primary }}>
          <AppText variant="subtitle">🧪 Simulador</AppText>
          <AppText variant="caption" color={colors.textSecondary}>
            "Probar lectura" pasa el texto por el mismo filtro e intérprete que las notificaciones reales y NO guarda nada.
            "Registrar de verdad" sí crea el movimiento, útil para demostraciones.
          </AppText>
          <Field label="App de origen (paquete)" value={pkg} onChangeText={setPkg} placeholder="com.nu.production" />
          <Field label="Texto de la notificación" value={text} onChangeText={setText} placeholder="Ej. Recibiste $67.000 de Juan" />
          <Button label="Probar lectura" disabled={!text.trim()} onPress={run} />
          <Button variant="ghost" label="Registrar de verdad" disabled={!text.trim() || !pkg.trim()} onPress={runReal} />
        </Card>
        <Card>
          <AppText variant="subtitle">Ejemplos</AppText>
          {SIMULATED_NOTIFICATIONS.map((s) => (
            <Button key={s.label} variant="ghost" label={s.label} onPress={() => { setPkg(s.packageName); setText(s.text); }} />
          ))}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}