import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Button, Card, Chip, Field, MoneyField, ScreenHeader } from '../src/components/ui';
import { DEBT_KIND_LABEL, getDebt, getInstallments, payInstallment, type Debt, type Installment } from '../src/services/debts';
import {
  assignExpenseToDebt, decreaseDebt, increaseDebt, listAdjustments, listAssignableExpenses, payDebtCapital, setCreditLimit,
  type AdjustKind, type AssignableExpense, type DebtAdjustment,
} from '../src/services/debtAdjust';
import { listAccounts } from '../src/services/repo';
import { useTheme } from '../src/theme/ThemeProvider';
import { formatCOP, parseDigits } from '../src/utils/format';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const dots = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const LABEL: Record<AdjustKind, string> = { increase: 'Aumento', decrease: 'Corrección', payment: 'Pago' };

export default function DebtAdjust() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ id: string }>();
  const id = String(params.id ?? '');
  const [debt, setDebt] = useState<Debt | null>(null);
  const [accounts, setAccounts] = useState<Awaited<ReturnType<typeof listAccounts>>>([]);
  const [history, setHistory] = useState<DebtAdjustment[]>([]);
  const [recent, setRecent] = useState<AssignableExpense[]>([]);
  const [next, setNext] = useState<Installment | null>(null);
  const [mode, setMode] = useState<AdjustKind>('increase');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [limit, setLimit] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const d = await getDebt(id);
    setDebt(d);
    if (!d) return;
    setAccounts(await listAccounts());
    setHistory(await listAdjustments(id));
    setRecent(await listAssignableExpenses());
    setNext(d.installments_total !== null ? ((await getInstallments(id)).find((i) => !i.paid_at) ?? null) : null);
    if (d.kind === 'credit_card') setLimit(d.credit_limit ? dots(d.credit_limit) : '');
  }, [id]);
  useFocusEffect(useCallback(() => { load().catch(() => {}); }, [load]));

  const fail = (e: unknown) => Alert.alert('No se pudo', e instanceof Error ? e.message : String(e));
  const assign = (t: AssignableExpense) => {
    if (!debt) return;
    Alert.alert('Convertir en pago', `¿"${t.merchant ?? 'Sin descripción'}" por ${formatCOP(t.amount)} fue un pago de ${debt.name}? Baja la deuda y deja de contarse como gasto. Tu cuenta no vuelve a moverse.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sí, fue pago', onPress: async () => { try { await assignExpenseToDebt(t.id, debt.id); setMsg('✓ Gasto convertido en pago.'); await load(); } catch (e) { fail(e); } } },
    ]);
  };
  const value = parseDigits(amount);
  const isCard = debt?.kind === 'credit_card';
  const scheduled = !!debt && debt.installments_total !== null;
  const date = (t: number) => { const d = new Date(t); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };

  const apply = async () => {
    if (busy || !debt) return;
    setBusy(true);
    setMsg(null);
    try {
      if (mode === 'increase') await increaseDebt(debt.id, value, note);
      else if (mode === 'decrease') await decreaseDebt(debt.id, value, note);
      else await payDebtCapital(debt.id, value, accountId);
      setAmount(''); setNote('');
      setMsg('✓ Listo, el saldo quedó actualizado.');
      await load();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const saveLimit = async () => {
    if (busy || !debt) return;
    setBusy(true);
    setMsg(null);
    try {
      await setCreditLimit(debt.id, parseDigits(limit));
      setMsg('✓ Cupo actualizado.');
      await load();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const payNext = () => {
    if (!next) return;
    Alert.alert(`Cuota ${next.number}`, `¿Marcar como pagada la cuota de ${formatCOP(next.total)} (${next.due_date}) sin descontar de ninguna cuenta?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sí, pagada', onPress: async () => { try { await payInstallment(next.id, null); setMsg('✓ Cuota marcada como pagada.'); await load(); } catch (e) { fail(e); } } },
    ]);
  };

  const HELP: Record<AdjustKind, string> = {
    increase: isCard
      ? 'Suma al saldo de la tarjeta. No toca tus cuentas.'
      : 'Suma al saldo (por ejemplo, te prestaron más). No toca tus cuentas: si el dinero entró por una notificación, ya está registrado.',
    payment: 'Baja el saldo y queda como pago de deuda. Si eliges una cuenta, se descuenta de ella; si fue en efectivo o en persona, no toca ninguna.',
    decrease: 'Baja el saldo sin mover dinero: te perdonaron una parte o estás corrigiendo un error.',
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
        <ScreenHeader title="Ajustar deuda" />
        {!debt ? (
          <AppText color={colors.textSecondary}>No encontré esa deuda.</AppText>
        ) : (
          <>
            <Card style={{ borderColor: colors.primary }}>
              <AppText variant="subtitle">{debt.name}</AppText>
              <AppText variant="caption" color={colors.textSecondary}>{DEBT_KIND_LABEL[debt.kind]}</AppText>
              <AppText variant="title" color={debt.status === 'paid' ? colors.success : colors.danger}>{formatCOP(debt.balance)}</AppText>
              <AppText variant="caption" color={colors.textSecondary}>{debt.status === 'paid' ? '✓ Pagada' : 'Saldo registrado'}</AppText>
            </Card>

            {scheduled ? (
              <Card>
                <AppText variant="subtitle">Plan con cuotas</AppText>
                <AppText variant="caption" color={colors.textSecondary}>
                  Este plan tiene un calendario de {debt.installments_total} cuotas, así que el saldo no se cambia a mano: se descuadraría. Si pagaste en persona, marca la cuota como pagada. Si te prestaron más, regístralo como una deuda o compra nueva.
                </AppText>
                {next ? (
                  <Button label={`Pagué la cuota ${next.number} (${formatCOP(next.total)})`} onPress={payNext} />
                ) : (
                  <AppText color={colors.success}>No quedan cuotas por pagar.</AppText>
                )}
              </Card>
            ) : (
              <Card>
                <AppText variant="subtitle">¿Qué pasó?</AppText>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Chip label={isCard ? '➕ Gasté más' : '➕ Me prestaron más'} selected={mode === 'increase'} onPress={() => setMode('increase')} />
                  <Chip label="💵 Pagué" selected={mode === 'payment'} onPress={() => setMode('payment')} />
                  <Chip label="✂ Corregir a la baja" selected={mode === 'decrease'} onPress={() => setMode('decrease')} />
                </View>
                <AppText variant="caption" color={colors.textSecondary}>{HELP[mode]}</AppText>
                <MoneyField label="Monto (COP)" value={amount} onChange={setAmount} />
                {mode === 'payment' ? (
                  <>
                    <AppText variant="caption" color={colors.textSecondary}>¿De dónde salió la plata?</AppText>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      <Chip label="Efectivo / en persona" selected={accountId === null} onPress={() => setAccountId(null)} />
                      {accounts.map((a) => <Chip key={a.id} label={a.name} selected={accountId === a.id} onPress={() => setAccountId(a.id)} />)}
                    </View>
                  </>
                ) : (
                  <Field label="Nota (opcional)" value={note} onChangeText={setNote} placeholder="Ej.: me prestó para el arriendo" />
                )}
                <Button label="Aplicar" onPress={apply} disabled={busy || value <= 0} />
              </Card>
            )}

            {recent.length > 0 && (
              <Card>
                <AppText variant="subtitle">¿Ya lo pagaste con un gasto?</AppText>
                <AppText variant="caption" color={colors.textSecondary}>
                  Si te descontaron plata de algo que en realidad era un pago de esta deuda, tócalo: baja la deuda y deja de contarse como gasto del mes.
                </AppText>
                {recent.map((t) => (
                  <Pressable key={t.id} onPress={() => assign(t)} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 6 }}>
                    <View style={{ flex: 1 }}>
                      <AppText variant="caption">{t.merchant ?? 'Sin descripción'}</AppText>
                      <AppText variant="caption" color={colors.textSecondary}>{date(t.occurred_at)}{t.account ? ` · ${t.account}` : ''}</AppText>
                    </View>
                    <AppText variant="caption" color={colors.danger}>{formatCOP(t.amount)}</AppText>
                  </Pressable>
                ))}
              </Card>
            )}

            {isCard && (
              <Card>
                <AppText variant="subtitle">Cupo de la tarjeta</AppText>
                <MoneyField label="Cupo total (COP)" value={limit} onChange={setLimit} />
                <Button variant="ghost" label="Guardar cupo" onPress={saveLimit} disabled={busy || parseDigits(limit) <= 0} />
              </Card>
            )}

            {!!msg && <AppText color={colors.success}>{msg}</AppText>}

            {history.length > 0 && (
              <Card>
                <AppText variant="subtitle">Últimos ajustes</AppText>
                {history.map((h) => (
                  <View key={h.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <AppText variant="caption">{date(h.created_at)} · {LABEL[h.kind]}</AppText>
                      {!!h.note && <AppText variant="caption" color={colors.textSecondary}>{h.note}</AppText>}
                    </View>
                    <AppText variant="caption" color={h.kind === 'increase' ? colors.danger : colors.success}>
                      {h.kind === 'increase' ? '+' : '−'}{formatCOP(h.amount)}
                    </AppText>
                  </View>
                ))}
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}