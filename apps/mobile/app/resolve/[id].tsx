import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addMonthsClamped, nextOccurrence, todayString } from '@finzen/core';
import { InstallmentForm, type InstallmentChoice } from '../../src/components/InstallmentForm';
import { AppText, Button, Card, Chip, InfoRow, ScreenHeader } from '../../src/components/ui';
import { useFocusData } from '../../src/hooks/useFocusData';
import { listCards } from '../../src/services/debts';
import { listAccounts } from '../../src/services/repo';
import {
  deleteTransaction, getTransaction, resolvePendingSinglePayment, resolvePendingWithAccount, resolvePendingWithPlan,
} from '../../src/services/transactions';
import { useTheme } from '../../src/theme/ThemeProvider';
import { formatCOP } from '../../src/utils/format';

/**
 * Pantalla "¿en cuántas cuotas?" — se abre desde el aviso de Inicio cuando llegó una
 * notificación de compra a crédito (Addi, Sistecrédito, tarjeta…).
 */
export default function ResolvePending() {
  const { colors } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tx] = useFocusData(() => getTransaction(String(id)), null);
  const [cards] = useFocusData(listCards, []);
  const [accounts] = useFocusData(listAccounts, []);
  const [cardId, setCardId] = useState<string | null>(null);
  const [mode, setMode] = useState<'installments' | 'single' | 'account'>('installments');

  if (!tx) return null;
  const isBnpl = tx.payment_method === 'bnpl';
  const effectiveCard = !isBnpl ? cards.find((c) => c.id === (cardId ?? cards[0]?.id)) ?? null : null;
  const suggested = /(\d+)\s+cuotas/.exec(tx.note ?? '')?.[1];
  const firstDue = effectiveCard?.due_day ? nextOccurrence(todayString(), effectiveCard.due_day) : addMonthsClamped(todayString(), 1);
  const done = () => router.back();

  const submitPlan = async (c: InstallmentChoice) => {
    await resolvePendingWithPlan(tx.id, {
      name: tx.merchant ?? 'Compra a cuotas',
      provider: isBnpl ? null : effectiveCard?.name ?? null,
      parentDebtId: effectiveCard?.id ?? null,
      installments: c.installments, mode: c.mode, firstDueDate: c.firstDueDate,
    });
    done();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
        <ScreenHeader title="Compra a crédito" />
        <Card>
          <InfoRow label="Comercio" value={tx.merchant ?? 'Sin nombre'} />
          <InfoRow label="Monto" value={formatCOP(tx.amount)} color={colors.danger} />
          <InfoRow label="Fecha" value={new Date(tx.occurred_at).toLocaleDateString('es-CO')} />
        </Card>

        {!isBnpl && cards.length > 0 && (
          <>
            <AppText variant="subtitle">¿Con qué tarjeta?</AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {cards.map((c) => (
                <Chip key={c.id} label={c.name} selected={effectiveCard?.id === c.id} onPress={() => setCardId(c.id)} />
              ))}
            </View>
          </>
        )}
        {!isBnpl && cards.length === 0 && (
          <AppText color={colors.warning}>No tienes tarjetas registradas. Se creará como compra a cuotas suelta; puedes agregar tu tarjeta en Deudas.</AppText>
        )}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Chip label="A cuotas" selected={mode === 'installments'} onPress={() => setMode('installments')} />
          {effectiveCard && <Chip label="A 1 pago (tarjeta)" selected={mode === 'single'} onPress={() => setMode('single')} />}
          <Chip label="No fue a crédito" selected={mode === 'account'} onPress={() => setMode('account')} />
        </View>

        {mode === 'installments' && (
          <InstallmentForm
            principal={tx.amount}
            defaultInstallments={suggested ? Number(suggested) : null}
            defaultFirstDue={firstDue}
            submitLabel="Confirmar cuotas"
            onSubmit={submitPlan}
          />
        )}
        {mode === 'single' && effectiveCard && (
          <Button label={`Sumar al saldo de ${effectiveCard.name}`} onPress={async () => { await resolvePendingSinglePayment(tx.id, effectiveCard.id); done(); }} />
        )}
        {mode === 'account' && (
          <View style={{ gap: 8 }}>
            <AppText color={colors.textSecondary}>Elige la cuenta de la que salió:</AppText>
            {accounts.map((a) => (
              <Button key={a.id} variant="ghost" label={a.name} onPress={async () => { await resolvePendingWithAccount(tx.id, a.id); done(); }} />
            ))}
            {accounts.length === 0 && <AppText color={colors.textSecondary}>No tienes cuentas registradas.</AppText>}
          </View>
        )}

        <Button variant="ghost" label="Descartar esta transacción" onPress={async () => { await deleteTransaction(tx.id); done(); }} />
      </ScrollView>
    </SafeAreaView>
  );
}
