import { ACCOUNT_KIND_LABEL, addAccount, listAccounts, patchRow, softDelete, reconcileAccountBalance, type AccountKind } from '../src/services/repo';
import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Button, Card, Chip, Field, MoneyField, ScreenHeader } from '../src/components/ui';
import { useFocusData } from '../src/hooks/useFocusData';
import { getDb } from '../src/services/db';
import { useTheme } from '../src/theme/ThemeProvider';
import { formatCOP, parseDigits } from '../src/utils/format';

const KINDS = Object.keys(ACCOUNT_KIND_LABEL) as AccountKind[];

export default function Accounts() {
  const { colors } = useTheme();
  const [items, reload] = useFocusData(listAccounts, []);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('savings');
  const [amount, setAmount] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [newBalance, setNewBalance] = useState('');

  const total = items.reduce((s, a) => s + a.balance, 0);

  const saveBalance = async (id: string) => {
    const db = await getDb();
    // Usamos la nueva función que crea una transacción de ajuste en el historial
    await db.withTransactionAsync(() => reconcileAccountBalance(db, id, parseDigits(newBalance)));
    setEditing(null); setNewBalance(''); reload();
  };

  const remove = (id: string, label: string) =>
    Alert.alert('Eliminar cuenta', `“${label}” desaparecerá de tu patrimonio. Los movimientos ya registrados se conservan.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: async () => { const db = await getDb(); await db.withTransactionAsync(() => softDelete(db, 'accounts', id)); reload(); } },
    ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }} keyboardShouldPersistTaps="handled">
        <ScreenHeader title="Cuentas y activos" />
        <AppText color={colors.textSecondary}>Total: {formatCOP(total)}</AppText>
        {items.map((a) => (
          <Card key={a.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <View>
                <AppText>{a.name}</AppText>
                <AppText variant="caption" color={colors.textSecondary}>{ACCOUNT_KIND_LABEL[a.kind]}</AppText>
              </View>
              <AppText color={colors.success}>{formatCOP(a.balance)}</AppText>
            </View>
            {editing === a.id ? (
              <>
                <MoneyField label="Saldo real hoy (COP)" value={newBalance} onChange={setNewBalance} />
                <Button label="Guardar saldo" onPress={() => saveBalance(a.id)} />
              </>
            ) : (
              <View style={{ flexDirection: 'row', gap: 16 }}>
                <Pressable onPress={() => { setEditing(a.id); setNewBalance(String(a.balance).replace(/\B(?=(\d{3})+(?!\d))/g, '.')); }}><AppText color={colors.primary}>Ajustar saldo</AppText></Pressable>
                <Pressable onPress={() => remove(a.id, a.name)}><AppText color={colors.danger}>Eliminar</AppText></Pressable>
              </View>
            )}
          </Card>
        ))}
        <Card>
          <AppText variant="subtitle">Agregar</AppText>
          <Field label="Nombre" value={name} onChangeText={setName} placeholder="Ej. Nequi, Bancolombia ahorros" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {KINDS.map((k) => <Chip key={k} label={ACCOUNT_KIND_LABEL[k]} selected={kind === k} onPress={() => setKind(k)} />)}
          </View>
          <MoneyField label="Saldo actual (COP)" value={amount} onChange={setAmount} />
          <Button label="Agregar cuenta" disabled={!name.trim()} onPress={async () => { await addAccount({ name: name.trim(), kind, balance: parseDigits(amount), currency: 'COP' }); setName(''); setAmount(''); reload(); }} />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
