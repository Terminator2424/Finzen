import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Button, Card, Chip, Field, MoneyField, ScreenHeader } from '../src/components/ui';
import {
  addReceivable, daysUntil, deleteReceivable, inDays, listReceivables, registerReceivablePayment, summarizeReceivables, type Receivable,
} from '../src/services/receivables';
import { useTheme } from '../src/theme/ThemeProvider';
import { formatCOP, parseDigits } from '../src/utils/format';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DUE_CHIPS = [
  { key: 'none', label: 'Sin fecha' },
  { key: '7', label: '7 días' },
  { key: '15', label: '15 días' },
  { key: '30', label: '30 días' },
  { key: 'custom', label: 'Otra fecha' },
];

const shortDate = (d: string) => {
  const [, m, day] = d.split('-');
  return `${Number(day)} ${MONTHS[Number(m) - 1] ?? ''}`;
};

function dueText(due: string | null): { text: string; level: 'none' | 'ok' | 'soon' | 'late' } {
  if (!due) return { text: 'Sin fecha de pago', level: 'none' };
  const n = daysUntil(due);
  if (n < 0) return { text: `Venció el ${shortDate(due)} · hace ${-n} día${n === -1 ? '' : 's'}`, level: 'late' };
  if (n === 0) return { text: 'Te paga hoy', level: 'soon' };
  if (n === 1) return { text: 'Te paga mañana', level: 'soon' };
  return { text: `Te paga el ${shortDate(due)} · en ${n} días`, level: n <= 7 ? 'soon' : 'ok' };
}

export default function Receivables() {
  const { colors } = useTheme();
  const [items, setItems] = useState<Receivable[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [debtor, setDebtor] = useState('');
  const [amount, setAmount] = useState('');
  const [dueKey, setDueKey] = useState('none');
  const [customDue, setCustomDue] = useState('');
  const [note, setNote] = useState('');
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { setItems(await listReceivables()); }, []);
  useFocusEffect(useCallback(() => { load().catch(() => {}); }, [load]));

  const pending = items.filter((r) => r.amount > r.paid);
  const done = items.filter((r) => r.amount <= r.paid).slice(0, 8);
  const sum = summarizeReceivables(items);
  const value = parseDigits(amount);
  const fail = (e: unknown) => Alert.alert('No se pudo', e instanceof Error ? e.message : String(e));
  const levelColor = (l: string) => (l === 'late' ? colors.danger : l === 'soon' ? colors.warning : colors.textSecondary);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const dueDate = dueKey === 'none' ? null : dueKey === 'custom' ? customDue.trim() : inDays(Number(dueKey));
      await addReceivable({ debtor, amount: value, dueDate, note });
      setDebtor(''); setAmount(''); setDueKey('none'); setCustomDue(''); setNote(''); setShowForm(false);
      await load();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const pay = async (r: Receivable, full: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await registerReceivablePayment(r.id, full ? undefined : parseDigits(payAmount));
      setPayingId(null); setPayAmount('');
      await load();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const remove = (r: Receivable) => Alert.alert('Eliminar', `¿Quitar a ${r.debtor} de la lista?`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Eliminar', style: 'destructive', onPress: async () => { try { await deleteReceivable(r.id); await load(); } catch (e) { fail(e); } } },
  ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
        <ScreenHeader title="Me deben" />

        <Card style={{ borderColor: colors.primary }}>
          <AppText variant="caption" color={colors.textSecondary}>Por cobrar</AppText>
          <AppText variant="title">{formatCOP(sum.total)}</AppText>
          <AppText variant="caption" color={sum.overdue > 0 ? colors.danger : colors.textSecondary}>
            {sum.people === 0
              ? 'Nadie te debe plata ahora.'
              : `${sum.people} persona${sum.people === 1 ? '' : 's'}${sum.overdue > 0 ? ` · ${sum.overdue} vencida${sum.overdue === 1 ? '' : 's'}` : ' · todo al día'}`}
          </AppText>
          <AppText variant="caption" color={colors.textSecondary}>Cuenta como un activo en tu patrimonio hasta que te paguen.</AppText>
        </Card>

        {showForm ? (
          <Card>
            <AppText variant="subtitle">Nuevo cobro</AppText>
            <Field label="¿Quién te debe?" value={debtor} onChangeText={setDebtor} autoCapitalize="words" placeholder="Nombre" />
            <MoneyField label="¿Cuánto? (COP)" value={amount} onChange={setAmount} />
            <AppText variant="caption" color={colors.textSecondary}>¿Cuándo te paga?</AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {DUE_CHIPS.map((c) => <Chip key={c.key} label={c.label} selected={dueKey === c.key} onPress={() => setDueKey(c.key)} />)}
            </View>
            {dueKey === 'custom' && (
              <Field label="Fecha (AAAA-MM-DD)" value={customDue} onChangeText={setCustomDue} autoCapitalize="none" placeholder="2026-12-15" />
            )}
            <Field label="Nota (opcional)" value={note} onChangeText={setNote} placeholder="Ej.: almuerzo del viernes" />
            <Button label="Guardar" onPress={save} disabled={busy || !debtor.trim() || value <= 0} />
            <Button variant="ghost" label="Cancelar" onPress={() => setShowForm(false)} />
          </Card>
        ) : (
          <Button label="＋ Registrar lo que me deben" onPress={() => setShowForm(true)} />
        )}

        {pending.length === 0 && !showForm && (
          <Card>
            <AppText color={colors.textSecondary}>
              Cuando alguien te deba plata, anótalo aquí: quién, cuánto y cuándo te paga. Se suma a tu patrimonio hasta que te pague.
            </AppText>
          </Card>
        )}

        {pending.map((r) => {
          const left = r.amount - r.paid;
          const pct = Math.max(0, Math.min(100, Math.round((r.paid / r.amount) * 100)));
          const due = dueText(r.due_date);
          return (
            <Card key={r.id} style={due.level === 'late' ? { borderColor: colors.danger } : undefined}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <AppText variant="subtitle">{r.debtor}</AppText>
                  {!!r.note && <AppText variant="caption" color={colors.textSecondary}>{r.note}</AppText>}
                </View>
                <AppText variant="subtitle" color={colors.primary}>{formatCOP(left)}</AppText>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden', marginTop: 8 }}>
                <View style={{ width: `${pct}%`, height: 6, backgroundColor: colors.success }} />
              </View>
              <AppText variant="caption" color={colors.textSecondary}>
                {r.paid > 0 ? `Ha pagado ${formatCOP(r.paid)} de ${formatCOP(r.amount)}` : `Le prestaste ${formatCOP(r.amount)}`}
              </AppText>
              <AppText variant="caption" color={levelColor(due.level)}>{due.text}</AppText>
              {payingId === r.id ? (
                <>
                  <MoneyField label="¿Cuánto te pagó?" value={payAmount} onChange={setPayAmount} />
                  <Button label="Guardar pago" disabled={busy || parseDigits(payAmount) <= 0} onPress={() => pay(r, false)} />
                  <Button variant="ghost" label="Cancelar" onPress={() => { setPayingId(null); setPayAmount(''); }} />
                </>
              ) : (
                <>
                  <Button label="Pagó todo" disabled={busy} onPress={() => pay(r, true)} />
                  <Button variant="ghost" label="Pagó una parte" onPress={() => { setPayingId(r.id); setPayAmount(''); }} />
                  <Button variant="ghost" label="Eliminar" onPress={() => remove(r)} />
                </>
              )}
            </Card>
          );
        })}

        {done.length > 0 && (
          <>
            <AppText variant="subtitle">Ya pagaron</AppText>
            {done.map((r) => (
              <Card key={r.id} style={{ opacity: 0.65 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <AppText>{r.debtor}</AppText>
                  <AppText color={colors.success}>✓ {formatCOP(r.amount)}</AppText>
                </View>
                <Button variant="ghost" label="Quitar del historial" onPress={() => remove(r)} />
              </Card>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}