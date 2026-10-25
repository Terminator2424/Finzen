import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addMonthKey, monthKey } from '@finzen/core';
import { AppText, Card } from '../../src/components/ui';
import { useFocusData } from '../../src/hooks/useFocusData';
import { deleteTransaction, listTransactions, monthTotals, type MonthTotals, type TxRow } from '../../src/services/transactions';
import { useTheme } from '../../src/theme/ThemeProvider';
import { formatCOP } from '../../src/utils/format';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const label = (m: string) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
const PAY_LABEL: Record<string, string> = { cash: 'Efectivo', debit: 'Débito', credit: 'Tarjeta', bnpl: 'Cuotas', unknown: '' };

export default function Transactions() {
  const { colors } = useTheme();
  const router = useRouter();
  const [month, setMonth] = useState(monthKey());
  const [data, reload] = useFocusData<{ rows: TxRow[]; totals: MonthTotals }>(
    async () => ({ rows: await listTransactions({ month }), totals: await monthTotals(month) }),
    { rows: [], totals: { income: 0, expense: 0, debtPayments: 0 } },
  );
  // Al cambiar de mes se recarga (useFocusData solo recarga al enfocar).
  React.useEffect(reload, [month, reload]);

  const remove = (t: TxRow) =>
    Alert.alert('Eliminar transacción', `${t.merchant ?? 'Sin nombre'} · ${formatCOP(t.amount)}`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar', style: 'destructive',
        onPress: async () => {
          const ok = await deleteTransaction(t.id);
          if (!ok) Alert.alert('No se puede', 'Esta compra pertenece a un plan de cuotas. Elimina la deuda desde "Deudas".');
          reload();
        },
      },
    ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 100 }}>
        {/* ... cabecera y tarjetas de totales ... */}

        {data.rows.length === 0 && <AppText color={colors.textSecondary}>Sin movimientos en este mes.</AppText>}
        {data.rows.map((t) => (
          <Pressable 
            key={t.id} 
            onLongPress={() => remove(t)} 
            onPress={() => router.push({ pathname: '/transaction/new', params: { id: t.id } })} // <-- NUEVO: Tocar para editar
          >
            <Card style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flexShrink: 1 }}>
                <AppText>{t.merchant ?? t.category_name ?? 'Sin descripción'}</AppText>
                <AppText variant="caption" color={colors.textSecondary}>
                  {new Date(t.occurred_at).toLocaleDateString('es-CO')} · {t.category_name ?? 'Sin categoría'}{PAY_LABEL[t.payment_method] ? ` · ${PAY_LABEL[t.payment_method]}` : ''}
                </AppText>
              </View>
              <AppText color={t.type === 'income' ? colors.success : colors.danger}>
                {t.type === 'income' ? '+' : '-'}{formatCOP(t.amount)}
              </AppText>
            </Card>
          </Pressable>
        ))}
        <AppText variant="caption" color={colors.textSecondary}>Toca para editar · Mantén presionada para eliminar.</AppText>
      </ScrollView>

      {/* ... botón flotante igual ... */}
    </SafeAreaView>
  );
}
