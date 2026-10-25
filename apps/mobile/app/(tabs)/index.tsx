import React from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { budgetStatus, monthKey } from '@finzen/core';
import { DonutChart, LineChart, ProgressBar } from '../../src/components/charts';
import { AppText, Card, InfoRow } from '../../src/components/ui';
import { useFocusData } from '../../src/hooks/useFocusData';
import { listSnapshots, recordSnapshot, type NetWorth, type Snapshot } from '../../src/services/repo';
import {
  listBudgetLines, listPending, listTransactions, monthTotals, spendingByCategory,
  type BudgetLine, type CategorySpend, type MonthTotals, type TxRow,
} from '../../src/services/transactions';
import { listDrafts } from '../../src/services/notifications';
import { getTotalRecurring } from '../../src/services/recurring'; // NUEVO IMPORT
import { upcomingPayments, type UpcomingPayment } from '../../src/services/debts';
import { useTheme } from '../../src/theme/ThemeProvider';
import { formatCOP } from '../../src/utils/format';

interface Dash {
  nw: NetWorth; snaps: Snapshot[]; totals: MonthTotals; spend: CategorySpend[];
  budgets: BudgetLine[]; recent: TxRow[]; pending: number; drafts: number; upcoming: UpcomingPayment[];
  recurringTotal: number; // NUEVO
}
const EMPTY: Dash = {
  nw: { assets: 0, liabilities: 0, net: 0 }, snaps: [], totals: { income: 0, expense: 0, debtPayments: 0 },
  spend: [], budgets: [], recent: [], pending: 0, drafts: 0, upcoming: [], recurringTotal: 0,
};

async function load(): Promise<Dash> {
  const m = monthKey();
  const nw = await recordSnapshot();
  return {
    nw, snaps: await listSnapshots(6), totals: await monthTotals(m), spend: await spendingByCategory(m),
    budgets: await listBudgetLines(m), recent: await listTransactions({ limit: 10 }),
    pending: (await listPending()).length, 
    drafts: (await listDrafts()).length, 
    upcoming: await upcomingPayments(3),
    recurringTotal: await getTotalRecurring(), // NUEVO: Cargamos el total
  };
}

export default function Dashboard() {
  const { colors } = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [d] = useFocusData(load, EMPTY);

  const prev = d.snaps.length >= 2 ? d.snaps[d.snaps.length - 2]! : null;
  const delta = prev ? d.nw.net - prev.net : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
        <AppText variant="title">Inicio</AppText>

        {d.drafts > 0 && (
          <Pressable onPress={() => router.push('/drafts')}>
            <Card style={{ borderColor: colors.primary }}>
              <AppText color={colors.primary}>📥 {d.drafts} notificación(es) por revisar</AppText>
              <AppText variant="caption" color={colors.textSecondary}>El motor no las entendió. Toca para procesarlas.</AppText>
            </Card>
          </Pressable>
        )}

        {d.pending > 0 && (
          <Pressable onPress={() => router.push('/pending')}>
            <Card style={{ borderColor: colors.warning }}>
              <AppText color={colors.warning}>⚠ {d.pending} compra(s) a crédito por completar</AppText>
              <AppText variant="caption" color={colors.textSecondary}>Toca para indicar en cuántas cuotas fueron.</AppText>
            </Card>
          </Pressable>
        )}

        <Card style={{ backgroundColor: colors.primary, borderColor: colors.primary }}>
          <AppText variant="caption" color={colors.onPrimary}>Patrimonio neto</AppText>
          <AppText variant="big" color={colors.onPrimary}>{formatCOP(d.nw.net)}</AppText>
          {delta !== null && (
            <AppText variant="caption" color={colors.onPrimary}>
              {delta >= 0 ? '▲' : '▼'} {formatCOP(Math.abs(delta))} vs. mes anterior
            </AppText>
          )}
        </Card>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Card style={{ flex: 1 }}>
            <AppText variant="caption" color={colors.textSecondary}>Activos</AppText>
            <AppText color={colors.success}>{formatCOP(d.nw.assets)}</AppText>
          </Card>
          <Card style={{ flex: 1 }}>
            <AppText variant="caption" color={colors.textSecondary}>Pasivos</AppText>
            <AppText color={colors.danger}>{formatCOP(d.nw.liabilities)}</AppText>
          </Card>
        </View>
        
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Card style={{ flex: 1 }}>
            <AppText variant="caption" color={colors.textSecondary}>Ingresos del mes</AppText>
            <AppText color={colors.success}>{formatCOP(d.totals.income)}</AppText>
          </Card>
          <Card style={{ flex: 1 }}>
            <AppText variant="caption" color={colors.textSecondary}>Gastos del mes</AppText>
            <AppText color={colors.danger}>{formatCOP(d.totals.expense)}</AppText>
          </Card>
        </View>

        {/* NUEVO: Tarjeta de Gastos Fijos */}
        {d.recurringTotal > 0 && (
          <Card style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
            <Pressable onPress={() => router.push('/recurring')} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <AppText variant="subtitle">Gastos fijos comprometidos</AppText>
                <AppText variant="caption" color={colors.textSecondary}>Arriendo, servicios, suscripciones…</AppText>
              </View>
              <AppText color={colors.warning}>{formatCOP(d.recurringTotal)}</AppText>
            </Pressable>
          </Card>
        )}

        {d.upcoming.length > 0 && (
          <Card>
            <AppText variant="subtitle">Próximos pagos</AppText>
            {d.upcoming.map((u) => <InfoRow key={u.installmentId} label={`${u.dueDate} · ${u.debtName}`} value={formatCOP(u.total)} />)}
          </Card>
        )}

        <Card>
          <AppText variant="subtitle">Gastos por categoría</AppText>
          <DonutChart data={d.spend.map((s) => ({ label: s.name, value: s.total }))} />
        </Card>

        <Card>
          <AppText variant="subtitle">Evolución del patrimonio</AppText>
          <LineChart points={d.snaps.map((s) => ({ label: s.month, value: s.net }))} width={Math.max(240, width - 40 - 34)} />
        </Card>

        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <AppText variant="subtitle">Presupuestos</AppText>
            <Pressable onPress={() => router.push('/budgets')}><AppText color={colors.primary}>Configurar</AppText></Pressable>
          </View>
          {d.budgets.length === 0 && <AppText color={colors.textSecondary}>Aún no tienes presupuestos.</AppText>}
          {d.budgets.map((b) => {
            const s = budgetStatus(b.spent, b.amount, b.threshold);
            return (
              <View key={b.categoryId} style={{ gap: 4 }}>
                <InfoRow label={b.name} value={`${formatCOP(b.spent)} / ${formatCOP(b.amount)}`} color={s.level === 'over' ? colors.danger : s.level === 'warn' ? colors.warning : undefined} />
                <ProgressBar ratio={s.ratio} level={s.level} />
                {s.level !== 'ok' && (
                  <AppText variant="caption" color={s.level === 'over' ? colors.danger : colors.warning}>
                    {s.level === 'over' ? `Te pasaste por ${formatCOP(-s.remaining)}` : `Llevas el ${Math.round(s.ratio * 100)} % del presupuesto`}
                  </AppText>
                )}
              </View>
            );
          })}
        </Card>

        <Card>
          <AppText variant="subtitle">Últimas transacciones</AppText>
          {d.recent.length === 0 && <AppText color={colors.textSecondary}>Todavía no hay transacciones. Agrega la primera en la pestaña Movimientos.</AppText>}
          {d.recent.map((t) => (
            <InfoRow key={t.id} label={t.merchant ?? t.category_name ?? 'Sin descripción'}
              value={`${t.type === 'income' ? '+' : '-'}${formatCOP(t.amount)}`} color={t.type === 'income' ? colors.success : colors.danger} />
          ))}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}