import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { rankDebts } from '@finzen/core';
import { ProgressBar } from '../../src/components/charts';
import { AppText, Button, Card } from '../../src/components/ui';
import { useFocusData } from '../../src/hooks/useFocusData';
import {
  DEBT_KIND_LABEL, cardSummary, listDebts, listPlansOf, upcomingPayments, type Debt,
} from '../../src/services/debts';
import { listPending } from '../../src/services/transactions';
import { useTheme } from '../../src/theme/ThemeProvider';
import { formatCOP } from '../../src/utils/format';

interface Overview {
  debts: Debt[];
  usage: Record<string, { used: number; available: number; utilization: number; nextDue: string | null }>;
  planCount: Record<string, number>;
  upcoming: Awaited<ReturnType<typeof upcomingPayments>>;
  pending: number;
}

async function loadOverview(): Promise<Overview> {
  const debts = await listDebts();
  const usage: Overview['usage'] = {};
  const planCount: Overview['planCount'] = {};
  for (const d of debts) {
    if (d.kind === 'credit_card') {
      const s = await cardSummary(d);
      usage[d.id] = { used: s.used, available: s.available, utilization: s.utilization, nextDue: s.nextDue };
      planCount[d.id] = (await listPlansOf(d.id)).filter((p) => p.status === 'active').length;
    }
  }
  return { debts, usage, planCount, upcoming: await upcomingPayments(4), pending: (await listPending()).length };
}

export default function Debts() {
  const { colors } = useTheme();
  const router = useRouter();
  const [o] = useFocusData<Overview>(loadOverview, { debts: [], usage: {}, planCount: {}, upcoming: [], pending: 0 });

  const ranking = rankDebts(o.debts.map((d) => ({ id: d.id, balance: d.balance, monthlyRate: d.monthly_rate })), 'avalanche');
  const first = ranking[0] ? o.debts.find((d) => d.id === ranking[0]!.id) : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
        <AppText variant="title">Deudas y tarjetas</AppText>

        {o.pending > 0 && (
          <Pressable onPress={() => router.push('/pending')}>
            <Card style={{ borderColor: colors.warning }}>
              <AppText color={colors.warning}>⚠ {o.pending} compra(s) a crédito por completar</AppText>
              <AppText variant="caption" color={colors.textSecondary}>Toca para indicar en cuántas cuotas fueron.</AppText>
            </Card>
          </Pressable>
        )}

        {o.upcoming.length > 0 && (
          <Card>
            <AppText variant="subtitle">Próximos pagos</AppText>
            {o.upcoming.map((u) => (
              <View key={u.installmentId} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <AppText variant="caption">{u.dueDate} · {u.debtName} {u.of ? `(${u.number}/${u.of})` : ''}</AppText>
                <AppText variant="caption">{formatCOP(u.total)}</AppText>
              </View>
            ))}
          </Card>
        )}

        {first && o.debts.length > 1 && (
          <Card>
            <AppText variant="caption" color={colors.textSecondary}>Método avalancha: si tienes dinero extra, abona primero a</AppText>
            <AppText variant="subtitle" color={colors.primary}>{first.name}</AppText>
            <AppText variant="caption" color={colors.textSecondary}>
              Es la de mayor interés ({(first.monthly_rate * 100).toFixed(2)} % mensual).
            </AppText>
          </Card>
        )}

        {o.debts.map((d) => {
          const u = o.usage[d.id];
          return (
            <Pressable key={d.id} onPress={() => router.push({ pathname: '/debt/[id]', params: { id: d.id } })}>
              <Card>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <View style={{ flexShrink: 1 }}>
                    <AppText variant="subtitle">{d.name}</AppText>
                    <AppText variant="caption" color={colors.textSecondary}>{DEBT_KIND_LABEL[d.kind]}</AppText>
                  </View>
                  <AppText color={colors.danger}>{formatCOP(u ? u.used : d.balance)}</AppText>
                </View>
                {u && d.credit_limit ? (
                  <>
                    <ProgressBar ratio={u.utilization} level={u.utilization > 1 ? 'over' : u.utilization >= 0.8 ? 'warn' : 'ok'} />
                    <AppText variant="caption" color={colors.textSecondary}>
                      Disponible {formatCOP(u.available)} de {formatCOP(d.credit_limit)}
                      {o.planCount[d.id] ? ` · ${o.planCount[d.id]} compra(s) a cuotas` : ''}
                    </AppText>
                    {u.nextDue && <AppText variant="caption" color={colors.textSecondary}>Próximo pago: {u.nextDue}</AppText>}
                  </>
                ) : (
                  d.monthly_payment ? <AppText variant="caption" color={colors.textSecondary}>Cuota {formatCOP(d.monthly_payment)}{d.due_day ? ` · día ${d.due_day}` : ''}</AppText> : null
                )}
              </Card>
            </Pressable>
          );
        })}

        {o.debts.length === 0 && <AppText color={colors.textSecondary}>Aún no tienes deudas registradas.</AppText>}
        <Button label="Agregar tarjeta o deuda" onPress={() => router.push('/debt/new')} />
      </ScrollView>
    </SafeAreaView>
  );
}
