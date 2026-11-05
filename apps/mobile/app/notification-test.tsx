import React, { useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { processNotification } from '@finzen/core';
import { AppText, Button, Card, Field, ScreenHeader } from '../src/components/ui';
import { SIMULATED_NOTIFICATIONS } from '../src/services/notifications';
import { useTheme } from '../src/theme/ThemeProvider';

export default function NotificationTest() {
  const { colors } = useTheme();
  const [text, setText] = useState('');
  const [pkg, setPkg] = useState('com.prueba.banco');

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
      `¿Pide cuotas?: ${p.needsInstallments ? 'Sí' : 'No'}\n\n` +
      `Texto enmascarado:\n${r.maskedText}`,
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
        <ScreenHeader title="Probar el lector" />
        <Card style={{ borderColor: colors.primary }}>
          <AppText variant="subtitle">🧪 Simulador</AppText>
          <AppText variant="caption" color={colors.textSecondary}>
            Pasa el texto por el mismo filtro de seguridad e intérprete que usan las notificaciones reales. No guarda nada.
          </AppText>
          <Field label="Texto de la notificación" value={text} onChangeText={setText} placeholder="Ej. Recibiste $67.000 de Juan" />
          <Button label="Probar lectura" disabled={!text.trim()} onPress={run} />
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