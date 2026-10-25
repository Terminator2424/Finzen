import React from 'react';
import { Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Card, InfoRow, ScreenHeader } from '../src/components/ui';
import { useFocusData } from '../src/hooks/useFocusData';
import { listPending } from '../src/services/transactions';
import { useTheme } from '../src/theme/ThemeProvider';
import { formatCOP } from '../src/utils/format';

/** Bandeja de compras a crédito detectadas por notificación que esperan saber el número de cuotas. */
export default function Pending() {
  const { colors } = useTheme();
  const router = useRouter();
  const [items] = useFocusData(listPending, []);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
        <ScreenHeader title="Por completar" />
        {items.length === 0 && <AppText color={colors.textSecondary}>No hay nada pendiente. 🎉</AppText>}
        {items.map((t) => (
          <Pressable key={t.id} onPress={() => router.push({ pathname: '/resolve/[id]', params: { id: t.id } })}>
            <Card>
              <InfoRow label={t.merchant ?? 'Compra a crédito'} value={formatCOP(t.amount)} color={colors.danger} />
              <AppText variant="caption" color={colors.textSecondary}>
                {new Date(t.occurred_at).toLocaleDateString('es-CO')} · {t.payment_method === 'bnpl' ? 'Compra a cuotas' : 'Tarjeta de crédito'} · toca para indicar las cuotas
              </AppText>
            </Card>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
