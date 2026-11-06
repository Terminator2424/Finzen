import React, { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Button, Card, Chip, MoneyField, ScreenHeader } from '../src/components/ui';
import { useFocusData } from '../src/hooks/useFocusData';
import { listAccounts } from '../src/services/repo';
import { createTransfer } from '../src/services/transactions';
import { useTheme } from '../src/theme/ThemeProvider';
import { formatCOP, parseDigits } from '../src/utils/format';

export default function Transfer() {
  const { colors } = useTheme();
  const router = useRouter();
  const [accounts] = useFocusData(listAccounts, []);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const value = parseDigits(amount);
  const ready = !!from && !!to && from !== to && value > 0;
  const nameOf = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? '…';

  const save = async () => {
    if (!ready || saving) return;
    setSaving(true);
    try {
      await createTransfer(from!, to!, value);
      router.back();
    } catch (e) {
      Alert.alert('No se pudo transferir', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
        <ScreenHeader title="Transferir entre mis cuentas" />
        <AppText color={colors.textSecondary}>
          Mueve plata entre dos cuentas tuyas. Los saldos cambian, pero no cuenta como ingreso ni como gasto del mes.
        </AppText>

        {accounts.length < 2 ? (
          <Card><AppText color={colors.warning}>Necesitas al menos dos cuentas. Créalas en Ajustes → Cuentas y activos.</AppText></Card>
        ) : (
          <>
            <Card>
              <AppText variant="subtitle">Desde</AppText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {accounts.map((a) => (
                  <Chip key={a.id} label={a.name} selected={from === a.id} onPress={() => { setFrom(a.id); if (to === a.id) setTo(null); }} />
                ))}
              </View>
            </Card>
            <Card>
              <AppText variant="subtitle">Hacia</AppText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {accounts.map((a) => (
                  <Chip key={a.id} label={a.name} selected={to === a.id} onPress={() => { setTo(a.id); if (from === a.id) setFrom(null); }} />
                ))}
              </View>
            </Card>
            <MoneyField label="Monto (COP)" value={amount} onChange={setAmount} />
            {ready && <AppText color={colors.textSecondary}>{formatCOP(value)} de {nameOf(from)} a {nameOf(to)}</AppText>}
            <Button label="Transferir" onPress={save} disabled={!ready || saving} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}