import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addMonthsClamped, nextOccurrence, parseSpokenExpense, todayString } from '@finzen/core';
import { InstallmentForm } from '../../src/components/InstallmentForm';
import { VoiceButton } from '../../src/components/VoiceButton';
import { AppText, Button, Card, Chip, Field, MoneyField, ScreenHeader } from '../../src/components/ui';
import { useFocusData } from '../../src/hooks/useFocusData';
import { listCards } from '../../src/services/debts';
import { listAccounts } from '../../src/services/repo';
import {
  createInstallmentPurchase, createTransaction, updateTransaction, listCategories, suggestCategory, getTransaction, type TxType,
  PaymentMethod,
} from '../../src/services/transactions';
import { useTheme } from '../../src/theme/ThemeProvider';
import { formatCOP, groupDigits, parseDigits } from '../../src/utils/format';
import { deleteDraft } from '../../src/services/notifications'; // <-- NUEVO

type Pay = { kind: 'account'; id: string } | { kind: 'card'; id: string } | { kind: 'bnpl' } | null;

export default function NewTransaction() {
  const { colors } = useTheme();
  const router = useRouter();
  
  // Paso B: Añadimos draftId a los parámetros
  const rawParams = useLocalSearchParams<{ amount?: string; merchant?: string; date?: string; id?: string; draftId?: string }>();
  
  // Validaciones básicas
  const params = {
    amount: /^\d{1,13}$/.test(String(rawParams.amount ?? '')) ? String(rawParams.amount) : undefined,
    merchant: rawParams.merchant ? String(rawParams.merchant).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 60) : undefined,
    date: Number.isFinite(Number(rawParams.date)) && Number(rawParams.date) > 0 && Number(rawParams.date) < 4.1e12 ? String(rawParams.date) : undefined,
    id: rawParams.id ? String(rawParams.id) : undefined,
    draftId: rawParams.draftId ? String(rawParams.draftId) : undefined, // <-- NUEVO
  };

  const isEditing = !!params.id;
  const [accounts] = useFocusData(listAccounts, []);
  const [cards] = useFocusData(listCards, []);
  const [categories] = useFocusData(listCategories, []);

  const [type, setType] = useState<TxType>('expense');
  const [amount, setAmount] = useState(params.amount ? groupDigits(params.amount) : '');
  const [merchant, setMerchant] = useState(params.merchant ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [userPickedCategory, setUserPickedCategory] = useState(false);
  const [pay, setPay] = useState<Pay>(null);
  const [provider, setProvider] = useState('');
  const [inInstallments, setInInstallments] = useState(false);
  const [saving, setSaving] = useState(false);

  // Cargar datos si estamos editando
  useEffect(() => {
    if (!isEditing) return;
    getTransaction(params.id!).then(tx => {
      if (!tx) return;
      setType(tx.type);
      setAmount(groupDigits(String(tx.amount)));
      if (tx.merchant) setMerchant(tx.merchant);
      if (tx.category_id) { setCategoryId(tx.category_id); setUserPickedCategory(true); }
      if (tx.account_id) setPay({ kind: 'account', id: tx.account_id });
      else if (tx.debt_id) setPay({ kind: 'card', id: tx.debt_id });
    });
  }, [isEditing, params.id]);

  const value = parseDigits(amount);
  const usesCredit = pay?.kind === 'card' || pay?.kind === 'bnpl';
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const visibleCats = categories.filter((c) => c.kind === type);

  useEffect(() => {
    if (userPickedCategory || !merchant.trim() || type !== 'expense') return;
    let alive = true;
    suggestCategory(merchant).then((id) => { if (alive && id) setCategoryId(id); });
    return () => { alive = false; };
  }, [merchant, userPickedCategory, type]);

  const selectedCard = pay?.kind === 'card' ? cards.find((c) => c.id === pay.id) ?? null : null;
  const defaultFirstDue = selectedCard?.due_day
    ? nextOccurrence(todayString(), selectedCard.due_day)
    : addMonthsClamped(todayString(), 1);

  const baseTx = () => ({
    type, amount: value, merchant: merchant.trim() || null,
    categoryId: categoryId ?? (type === 'income' ? 'cat_ingreso_otros' : 'cat_otros'),
    occurredAt: params.date ? Number(params.date) : undefined,
  });

  // Paso C: Función save corregida
  const save = async () => {
    if (!value || saving) return;
    setSaving(true);
    try {
      // 1. Arreglamos el tipo 'any'
      let paymentMethod: PaymentMethod = 'cash';
      let accountId: string | null = null;
      let cardId: string | null = null;

      if (pay?.kind === 'card') { paymentMethod = 'credit'; cardId = pay.id; }
      else if (pay?.kind === 'account') { paymentMethod = 'debit'; accountId = pay.id; }

      if (isEditing) {
        // MODO EDICIÓN
        const ok = await updateTransaction(params.id!, { ...baseTx(), paymentMethod, accountId, cardId });
        
        // 2. Arreglamos el atasco si falla
        if (!ok) {
          Alert.alert('No se puede', 'Esta compra pertenece a un plan de cuotas. Elimínala desde "Deudas" si necesitas cambiarla.');
          router.back(); // <-- Nos aseguramos de salir
          return;        // <-- Cortamos la ejecución aquí
        }
      } else {
        // MODO CREACIÓN
        await createTransaction({ ...baseTx(), paymentMethod, accountId, cardId });
        
        // 3. Arreglamos el borrado del Draft
        if (params.draftId) {
          await deleteDraft(params.draftId);
        }
      }
      router.back();
    } finally { 
      setSaving(false); 
    }
  };

  const saveInstallments = async (c: { installments: number; mode: any; firstDueDate: string }) => {
    if (!value || saving || !pay || isEditing) return; // No se permiten cuotas en edición directa
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
      router.back();
    } finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
        <ScreenHeader title={isEditing ? "Editar transacción" : "Nueva transacción"} />

        {!isEditing && (
          <>
            <VoiceButton onText={(t) => {
              const v = parseSpokenExpense(t);
              setType(v.type);
              if (v.amount) setAmount(groupDigits(String(v.amount)));
              if (v.merchant) { setMerchant(v.merchant); setUserPickedCategory(false); }
            }} />
            <Button variant="ghost" label="📷 Escanear un recibo" onPress={() => router.push('/scan')} />
          </>
        )}

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Chip label="Gasto" selected={type === 'expense'} onPress={() => { setType('expense'); setCategoryId(null); setUserPickedCategory(false); }} />
          <Chip label="Ingreso" selected={type === 'income'} onPress={() => { setType('income'); setCategoryId(null); setPay(null); setInInstallments(false); }} />
        </View>

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
            {/* Ocultamos Addi/Cuotas si estamos editando para evitar descuadres de calendarios */}
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
          <Button label={isEditing ? "Guardar cambios" : "Guardar"} onPress={save} disabled={!value || saving} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}