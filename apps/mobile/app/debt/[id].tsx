import {
  DEBT_KIND_LABEL, cardSummary, deleteDebt, getDebt, getInstallments, listPlansOf, payCard, payCapital, payInstallment,
  type Debt, type Installment,
} from '../../src/services/debts';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { compareExtraPayment, eaFromMonthlyRate } from '@finzen/core';
import { ProgressBar } from '../../src/components/charts';
import { AppText, Button, Card, Chip, Field, InfoRow, MoneyField, ScreenHeader } from '../../src/components/ui';
import { useFocusData } from '../../src/hooks/useFocusData';
import { listAccounts } from '../../src/services/repo';
import { useTheme } from '../../src/theme/ThemeProvider';
import { formatCOP, parseDigits } from '../../src/utils/format';

interface Detail {
  debt: Debt | null;
  installments: Installment[];
  plans: Debt[];
  card: Awaited<ReturnType<typeof cardSummary>> | null;
}

async function load(id: string): Promise<Detail> {
  const debt = await getDebt(id);
  if (!debt) return { debt: null, installments: [], plans: [], card: null };
  return {
    debt,
    installments: await getInstallments(id),
    plans: debt.kind === 'credit_card' ? await listPlansOf(id) : [],
    card: debt.kind === 'credit_card' ? await cardSummary(debt) : null,
  };
}

export default function DebtDetail() {
  const { colors } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [d, reload] = useFocusData<Detail>(() => load(String(id)), { debt: null, installments: [], plans: [], card: null });
  const [accounts] = useFocusData(listAccounts, []);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');

  // Simulador "¿qué pasa si abono extra?"
  const [simPayment, setSimPayment] = useState('');
  const [simExtra, setSimExtra] = useState('');
  const [simMode, setSimMode] = useState<'monthly' | 'oneTime'>('monthly');

  const debt = d.debt;
  const isCard = debt?.kind === 'credit_card';
  const basePayment = debt ? (parseDigits(simPayment) || Math.max(0, (debt.monthly_payment ?? 0) - debt.fixed_fee_per_installment)) : 0;
  const sim = useMemo(() => {
    const extra = parseDigits(simExtra);
    if (!debt || !extra || !basePayment || debt.balance <= 0) return null;
    return compareExtraPayment(debt.balance, debt.monthly_rate, basePayment, extra, simMode);
  }, [debt, simExtra, simMode, basePayment]);

  if (!debt) return null;
  const pendingInst = d.installments.filter((i) => !i.paid_at);
  const paidInst = d.installments.length - pendingInst.length;

  const confirmDelete = () =>
    Alert.alert('Eliminar deuda', 'Se eliminará con su calendario de cuotas (y los planes de la tarjeta, si es una tarjeta). ¿Continuar?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: async () => { await deleteDebt(debt.id); router.back(); } },
    ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
        <ScreenHeader title={debt.name} />
        <AppText color={colors.textSecondary}>{DEBT_KIND_LABEL[debt.kind]}{debt.provider ? ` · ${debt.provider}` : ''}</AppText>

        {/* ───── Tarjeta: cupo, corte y pago ───── */}
        {isCard && d.card && (
          <Card>
            <ProgressBar ratio={d.card.utilization} level={d.card.utilization > 1 ? 'over' : d.card.utilization >= 0.8 ? 'warn' : 'ok'} />
            <InfoRow label="Cupo total" value={formatCOP(debt.credit_limit ?? 0)} />
            <InfoRow label="Cupo usado" value={formatCOP(d.card.used)} color={colors.danger} />
            <InfoRow label="Cupo disponible" value={formatCOP(d.card.available)} color={colors.success} />
            <InfoRow label="Saldo sin diferir" value={formatCOP(debt.balance)} />
            {d.card.nextCut && <InfoRow label="Próximo corte" value={d.card.nextCut} />}
            {d.card.nextDue && <InfoRow label="Próximo pago límite" value={d.card.nextDue} />}
            {debt.monthly_rate > 0 && debt.balance > 0 && (
              <AppText variant="caption" color={colors.warning}>
                Si no pagas el saldo sin diferir completo, pagarías ≈ {formatCOP(d.card.estimatedMonthlyInterest)} de interés este mes.
              </AppText>
            )}
          </Card>
        )}
        {!isCard && (
          <Card>
            <InfoRow label="Monto financiado" value={formatCOP(debt.principal)} />
            <InfoRow label="Saldo pendiente" value={formatCOP(debt.balance)} color={colors.danger} />
            {debt.monthly_payment ? <InfoRow label="Cuota mensual" value={formatCOP(debt.monthly_payment)} /> : null}
            {debt.monthly_rate > 0 && (
              <InfoRow label="Tasa" value={`${(debt.monthly_rate * 100).toFixed(2)} % mensual · ${(eaFromMonthlyRate(debt.monthly_rate) * 100).toFixed(1)} % E.A.`} />
            )}
            {debt.fixed_fee_per_installment > 0 && <InfoRow label="Cargo fijo por cuota" value={formatCOP(debt.fixed_fee_per_installment)} />}
            {debt.installments_total ? <InfoRow label="Progreso" value={`${paidInst} de ${debt.installments_total} cuotas pagadas`} /> : null}
            {debt.installments_total ? <ProgressBar ratio={paidInst / debt.installments_total} /> : null}
          </Card>
        )}

        {/* ───── De dónde descuentan los pagos ───── */}
        {(isCard || pendingInst.length > 0) && accounts.length > 0 && (
          <Card>
            <AppText variant="caption" color={colors.textSecondary}>Pagar desde la cuenta:</AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Chip label="Ninguna" selected={accountId === null} onPress={() => setAccountId(null)} />
              {accounts.map((a) => <Chip key={a.id} label={a.name} selected={accountId === a.id} onPress={() => setAccountId(a.id)} />)}
            </View>
          </Card>
        )}

        {isCard && (
          <Card>
            <AppText variant="subtitle">Pagar la tarjeta</AppText>
            <MoneyField label="Monto a pagar (COP)" value={payAmount} onChange={setPayAmount} />
            <Button label="Registrar pago" disabled={!parseDigits(payAmount) || debt.balance <= 0}
              onPress={async () => { await payCard(debt.id, parseDigits(payAmount), accountId); setPayAmount(''); reload(); }} />
            <AppText variant="caption" color={colors.textSecondary}>Las cuotas de compras diferidas se pagan desde cada compra, abajo.</AppText>
          </Card>
        )}

                {/* ───── Abono a capital para deudas que NO son tarjetas ───── */}
        {!isCard && debt.status === 'active' && (
          <Card>
            <AppText variant="subtitle">Abonar a capital</AppText>
            <AppText variant="caption" color={colors.textSecondary}>
              Reduce el saldo total de la deuda con un pago extra o libre.
            </AppText>
            <MoneyField label="Monto del abono (COP)" value={payAmount} onChange={setPayAmount} />
            <Button 
              label="Registrar abono" 
              disabled={!parseDigits(payAmount) || debt.balance <= 0}
              onPress={async () => { 
                await payCapital(debt.id, parseDigits(payAmount), accountId); 
                setPayAmount(''); 
                reload(); 
              }} 
            />
          </Card>
        )}

        {/* ───── Compras a cuotas de la tarjeta ───── */}
        {isCard && (
          <>
            <AppText variant="subtitle">Compras a cuotas</AppText>
            {d.plans.length === 0 && <AppText color={colors.textSecondary}>Ninguna todavía.</AppText>}
            {d.plans.map((p) => (
              <Pressable key={p.id} onPress={() => router.push({ pathname: '/debt/[id]', params: { id: p.id } })}>
                <Card>
                  <InfoRow label={p.name} value={formatCOP(p.balance)} color={p.status === 'paid' ? colors.success : colors.danger} />
                  <AppText variant="caption" color={colors.textSecondary}>
                    {p.status === 'paid' ? 'Pagada' : `Cuota ${formatCOP(p.monthly_payment ?? 0)} · ${p.installments_total} cuotas`}
                  </AppText>
                </Card>
              </Pressable>
            ))}
            <Button variant="ghost" label="Agregar compra a cuotas" onPress={() => router.push('/transaction/new')} />
          </>
        )}

        {/* ───── Calendario ───── */}
        {d.installments.length > 0 && (
          <>
            <AppText variant="subtitle">Calendario de cuotas</AppText>
            {d.installments.map((i) => (
              <Card key={i.id} style={{ opacity: i.paid_at ? 0.55 : 1 }}>
                <InfoRow label={`Cuota ${i.number} · ${i.due_date}`} value={formatCOP(i.total)} />
                <AppText variant="caption" color={colors.textSecondary}>
                  Capital {formatCOP(i.principal)} · Interés {formatCOP(i.interest)}{i.fee ? ` · Cargo ${formatCOP(i.fee)}` : ''}
                </AppText>
                {i.paid_at ? (
                  <AppText variant="caption" color={colors.success}>✓ Pagada</AppText>
                ) : (
                  <Button variant="ghost" label="Marcar como pagada" onPress={async () => { await payInstallment(i.id, accountId); reload(); }} />
                )}
              </Card>
            ))}
          </>
        )}

        {/* ───── Simulador ───── */}
        {debt.balance > 0 && (isCard ? debt.monthly_rate > 0 : true) && (
          <Card>
            <AppText variant="subtitle">Simulador de abono extra</AppText>
            <AppText variant="caption" color={colors.textSecondary}>¿Qué pasa si pago más? Calcula meses e intereses ahorrados.</AppText>
            <MoneyField label={`Pago mensual normal (COP)${basePayment ? '' : ' — escríbelo'}`} value={simPayment || (basePayment ? String(basePayment).replace(/\B(?=(\d{3})+(?!\d))/g, '.') : '')} onChange={setSimPayment} />
            <MoneyField label="Abono extra (COP)" value={simExtra} onChange={setSimExtra} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Chip label="Cada mes" selected={simMode === 'monthly'} onPress={() => setSimMode('monthly')} />
              <Chip label="Una sola vez" selected={simMode === 'oneTime'} onPress={() => setSimMode('oneTime')} />
            </View>
            {sim && (
              sim.base.neverPaysOff ? (
                <AppText color={colors.danger}>Con ese pago mensual la deuda no baja: no cubre ni los intereses.</AppText>
              ) : (
                <View style={{ gap: 4 }}>
                  <InfoRow label="Sin abono extra" value={`${sim.base.months} meses · ${formatCOP(sim.base.totalInterest)} de interés`} />
                  <InfoRow label="Con abono extra" value={`${sim.withExtra.months} meses · ${formatCOP(sim.withExtra.totalInterest)} de interés`} />
                  <AppText color={colors.success}>Ahorras {sim.monthsSaved} meses y {formatCOP(sim.interestSaved)}.</AppText>
                </View>
              )
            )}
          </Card>
        )}

        <Button variant="ghost" label="Eliminar deuda" onPress={confirmDelete} />
      </ScrollView>
    </SafeAreaView>
  );
}
