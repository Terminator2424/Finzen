import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addMonthsClamped, nextOccurrence, parseSpokenExpense, todayString } from '@finzen/core';
import { InstallmentForm } from '../../src/components/InstallmentForm';
import { VoiceButton } from '../../src/components/VoiceButton';
import { AppText, Button, Card, Chip, Field, MoneyField, ScreenHeader } from '../../src/components/ui';
import { useFocusData } from '../../src/hooks/useFocusData';
import { listCards, listDebts, payCapital, payCard } from '../../src/services/debts';
import { listAccounts } from '../../src/services/repo';
import {
  createInstallmentPurchase, createTransaction, updateTransaction, listCategories, suggestCategory, getTransaction,
  findAccountForApp, findCardsForApp, type TxType, type PaymentMethod,
} from '../../src/services/transactions';
import { useTheme } from '../../src/theme/ThemeProvider';
import { formatCOP, groupDigits, parseDigits } from '../../src/utils/format';
import { deleteDraft } from '../../src/services/notifications';

type Pay = { kind: 'account'; id: string } | { kind: 'card'; id: string } | { kind: 'bnpl' } | null;
type Mode = TxType | 'debt';

export default function NewTransaction() {
  const { colors } = useTheme();
  const router = useRouter();

  const rawParams = useLocalSearchParams<{ amount?: string; merchant?: string; date?: string; id?: string; draftId?: string; kind?: string; pkg?: string }>();

  const params = {
    amount: /^\d{1,13}$/.test(String(rawParams.amount ?? '')) ? String(rawParams.amount) : undefined,
    merchant: rawParams.merchant ? String(rawParams.merchant).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 60) : undefined,
    date: Number.isFinite(Number(rawParams.date)) && Number(rawParams.date) > 0 && Number(rawParams.date) < 4.1e12 ? String(rawParams.date) : undefined,
    id: rawParams.id ? String(rawParams.id) : undefined,
    draftId: rawParams.draftId ? String(rawParams.draftId) : undefined,
    kind: rawParams.kind === 'debt' ? ('debt' as const) : undefined,
    pkg: rawParams.pkg && /^[A-Za-z0-9._]{1,120}$/.test(String(rawParams.pkg)) ? String(rawParams.pkg) : undefined,
  };

  const isEditing = !!params.id;
  const [accounts] = useFocusData(listAccounts, []);
  const [cards] = useFocusData(listCards, []);
  const [debts] = useFocusData(listDebts, []);
  const [categories] = useFocusData(listCategories, []);

  const [mode, setMode] = useState<Mode>(params.kind ?? 'expense');
  const type: TxType = mode === 'income' ? 'income' : 'expense';
  const [amount, setAmount] = useState(params.amount ? groupDigits(params.amount) : '');
  const [merchant, setMerchant] = useState(params.merchant ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [userPickedCategory, setUserPickedCategory] = useState(false);
  const [pay, setPay] = useState<Pay>(null);
  const [provider, setProvider] = useState('');
  const [inInstallments, setInInstallments] = useState(false);
  const [saving, setSaving] = useState(false);
  const [debtId, setDebtId] = useState<string | null>(null);
  const [debtAccount, setDebtAccount] = useState<string | null>(null);

  useEffect(() => {
    if (!isEditing) return;
    getTransaction(params.id!).then(tx => {
      if (!tx) return;
      setMode(tx.type);
      setAmount(groupDigits(String(tx.amount)));
      if (tx.merchant) setMerchant(tx.merchant);
      if (tx.category_id) { setCategoryId(tx.category_id); setUserPickedCategory(true); }
      if (tx.account_id) setPay({ kind: 'account', id: tx.account_id });
      else if (tx.debt_id) setPay({ kind: 'card', id: tx.debt_id });
    });
  }, [isEditing, params.id]);

  // Abono a deuda desde un borrador: si la app tiene UNA tarjeta y UNA cuenta que calzan, se preseleccionan.
  useEffect(() => {
    if (mode !== 'debt' || !params.pkg) return;
    let alive = true;
    findCardsForApp(params.pkg).then((c) => { if (alive && c.length === 1) setDebtId((cur) => cur ?? c[0]!.id); });
    findAccountForApp(params.pkg).then((a) => { if (alive && a) setDebtAccount((cur) => cur ?? a); });
    return () => { alive = false; };
  }, [mode, params.pkg]);

  const value = parseDigits(amount);
  const usesCredit = pay?.kind === 'card' || pay?.kind === 'bnpl';
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const visibleCats = categories.filter((c) => c.kind === type);
  const selectedDebt = debts.find((d) => d.id === debtId) ?? null;

  useEffect(() => {
    if (userPickedCategory || !merchant.trim() || type !== 'expense' || mode === 'debt') return;
    let alive = true;
    suggestCategory(merchant).then((id) => { if (alive && id) setCategoryId(id); });
    return () => { alive = false; };
  }, [merchant, userPickedCategory, type, mode]);

  const selectedCard = pay?.kind === 'card' ? cards.find((c) => c.id === pay.id) ?? null : null;
  const defaultFirstDue = selectedCard?.due_day
    ? nextOccurrence(todayString(), selectedCard.due_day)
    : addMonthsClamped(todayString(), 1);

  const baseTx = () => ({
    type, amount: value, merchant: merchant.trim() || null,
    categoryId: categoryId ?? (type === 'income' ? 'cat_ingreso_otros' : 'cat_otros'),
    occurredAt: params.date ? Number(params.date) : undefined,
  });

  const save = async () => {
    if (!value || saving) return;
    setSaving(true);
    try {
      let paymentMethod: PaymentMethod = 'cash';
      let accountId: string | null = null;
      let cardId: string | null = null;

      if (pay?.kind === 'card') { paymentMethod = 'credit'; cardId = pay.id; }
      else if (pay?.kind === 'account') { paymentMethod = 'debit'; accountId = pay.id; }

      if (isEditing) {
        const ok = await updateTransaction(params.id!, { ...baseTx(), paymentMethod, accountId, cardId });
        if (!ok) {
          Alert.alert('No se puede editar aquí', 'Es una compra a cuotas o un pago de deuda. Elimínala desde su pantalla y vuelve a registrarla.');
          router.back();
          return;
        }
      } else {
        await createTransaction({ ...baseTx(), paymentMethod, accountId, cardId });
        if (params.draftId) {
          await deleteDraft(params.draftId);
        }
      }
      router.back();
    } finally {
      setSaving(false);
    }
  };

  const saveDebtPayment = async () => {
    if (!value || !debtId || saving) return;
    const d = debts.find((x) => x.id === debtId);
    if (!d) return;
    setSaving(true);
    try {
      if (d.kind === 'credit_card') await payCard(d.id, value, debtAccount);
      else await payCapital(d.id, value, debtAccount);
      if (params.draftId) await deleteDraft(params.draftId);
      router.back();
    } finally {
      setSaving(false);
    }
  };

  const saveInstallments = async (c: { installments: number; mode: any; firstDueDate: string }) => {
    if (!value || saving || !pay || isEditing) return;
    setSaving(true);
    try {
      const label = baseTx().merchant ?? 'Compra a cuotas';
      await createInstallmentPurchase(
        { ...baseTx(), paymentMethod: pay.kind === 'bnpl' ? 'bnpl' : 'credit' },
        {
          name: label, provider: pay.kind === 'bnpl' ? provider.trim() || null : selectedCard?.name ?? null,
          parentDebtId: pay.kind === 'card' ? pay.id : null,
          installments: c.installments, mode: c.mode, firstDueDate: c.firstDueDate,
        },
      );
      if (params.draftId) {
        await deleteDraft(params.draftId);
      }
      router.back();
    } finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
        <ScreenHeader title={isEditing ? 'Editar transacción' : mode === 'debt' ? 'Abono a deuda' : 'Nueva transacción'} />

        {!isEditing && mode !== 'debt' && (
          <>
            <VoiceButton onText={(t) => {
              const v = parseSpokenExpense(t);
              setMode(v.type);
              if (v.amount) setAmount(groupDigits(String(v.amount)));
              if (v.merchant) { setMerchant(v.merchant); setUserPickedCategory(false); }
            }} />
            <Button variant="ghost" label="📷 Escanear un recibo" onPress={() => router.push('/scan')} />
          </>
        )}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Chip label="Gasto" selected={mode === 'expense'} onPress={() => { setMode('expense'); setCategoryId(null); setUserPickedCategory(false); }} />
          <Chip label="Ingreso" selected={mode === 'income'} onPress={() => { setMode('income'); setCategoryId(null); setPay(null); setInInstallments(false); }} />
          {!isEditing && (
            <Chip label="Abono a deuda" selected={mode === 'debt'} onPress={() => { setMode('debt'); setPay(null); setInInstallments(false); }} />
          )}
        </View>

        {mode === 'debt' ? (
          <>
            <MoneyField label="Monto del abono (COP)" value={amount} onChange={setAmount} />

            <Card>
              <AppText variant="subtitle">¿Qué deuda pagas?</AppText>
              {debts.length === 0 ? (
                <AppText color={colors.textSecondary}>
                  Aún no tienes deudas registradas. Crea la tarjeta o el crédito en la sección de Deudas y vuelve aquí.
                </AppText>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {debts.map((d) => (
                    <Chip key={d.id} label={`${d.kind === 'credit_card' ? '💳' : '🏦'} ${d.name}`} selected={debtId === d.id} onPress={() => setDebtId(d.id)} />
                  ))}
                </View>
              )}
              {selectedDebt && (
                <AppText variant="caption" color={colors.textSecondary}>Saldo actual: {formatCOP(selectedDebt.balance)}</AppText>
              )}
            </Card>

            <Card>
              <AppText variant="subtitle">¿De dónde sale la plata?</AppText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {accounts.map((a) => (
                  <Chip key={a.id} label={a.name} selected={debtAccount === a.id} onPress={() => setDebtAccount(debtAccount === a.id ? null : a.id)} />
                ))}
              </View>
              <AppText variant="caption" color={colors.textSecondary}>
                Si eliges una cuenta, el abono se descuenta de ella. Toca otra vez para quitarla.
              </AppText>
            </Card>

            <Button label="Registrar abono" onPress={saveDebtPayment} disabled={!value || !debtId || saving} />
          </>
        ) : (
          <>
            <MoneyField label="Monto (COP)" value={amount} onChange={setAmount} />
            <Field label={type === 'expense' ? 'Comercio o descripción' : 'Origen del ingreso'} value={merchant} onChangeText={setMerchant} placeholder="Ej. Rappi, Falabella, Salario" />

            <Card>
              <AppText variant="subtitle">Categoría</AppText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {visibleCats.map((c) => {
                  const parent = c.parent_id ? catById.get(c.parent_id) : null;
                  return (
                    <Chip key={c.id} label={parent ? `${parent.name} › ${c.name}` : c.name} selected={categoryId === c.id}
                      onPress={() => { setCategoryId(c.id); setUserPickedCategory(true); }} />
                  );
                })}
              </View>
            </Card>

            <Card>
              <AppText variant="subtitle">{type === 'expense' ? '¿Con qué pagaste?' : '¿A qué cuenta entró?'}</AppText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {accounts.map((a) => (
                  <Chip key={a.id} label={a.name} selected={pay?.kind === 'account' && pay.id === a.id}
                    onPress={() => { setPay({ kind: 'account', id: a.id }); setInInstallments(false); }} />
                ))}
                {type === 'expense' && cards.map((c) => (
                  <Chip key={c.id} label={`💳 ${c.name}`} selected={pay?.kind === 'card' && pay.id === c.id}
                    onPress={() => setPay({ kind: 'card', id: c.id })} />
                ))}
                {type === 'expense' && !isEditing && (
                  <Chip label="Addi / Sistecrédito / otro" selected={pay?.kind === 'bnpl'} onPress={() => { setPay({ kind: 'bnpl' }); setInInstallments(true); }} />
                )}
              </View>
            </Card>

            {pay?.kind === 'bnpl' && (
              <Field label="¿Cuál? (Addi, Sistecrédito…)" value={provider} onChangeText={setProvider} />
            )}

            {usesCredit && pay?.kind === 'card' && !isEditing && (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Chip label="A 1 pago" selected={!inInstallments} onPress={() => setInInstallments(false)} />
                <Chip label="Diferido a cuotas" selected={inInstallments} onPress={() => setInInstallments(true)} />
              </View>
            )}

            {usesCredit && inInstallments && !isEditing ? (
              value > 0 ? (
                <Card>
                  <AppText color={colors.textSecondary}>Compra de {formatCOP(value)} a cuotas</AppText>
                  <InstallmentForm principal={value} defaultFirstDue={defaultFirstDue} submitLabel="Guardar compra a cuotas" onSubmit={saveInstallments} />
                </Card>
              ) : <AppText color={colors.textSecondary}>Escribe el monto para calcular las cuotas.</AppText>
            ) : (
              <Button label={isEditing ? 'Guardar cambios' : 'Guardar'} onPress={save} disabled={!value || saving} />
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}