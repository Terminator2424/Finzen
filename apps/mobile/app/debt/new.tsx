import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Button, Chip, Field, MoneyField, ScreenHeader } from '../../src/components/ui';
import { DEBT_KIND_LABEL, createDebt, type DebtKind } from '../../src/services/debts';
import { useTheme } from '../../src/theme/ThemeProvider';
import { parseDigits } from '../../src/utils/format';

const KINDS = Object.keys(DEBT_KIND_LABEL) as DebtKind[];
const day = (t: string) => { const d = parseDigits(t); return d >= 1 && d <= 31 ? d : null; };

export default function NewDebt() {
  const { colors } = useTheme();
  const router = useRouter();
  const [kind, setKind] = useState<DebtKind>('credit_card');
  const [name, setName] = useState('');
  const [limit, setLimit] = useState('');
  const [balance, setBalance] = useState('');
  const [payment, setPayment] = useState('');
  const [rate, setRate] = useState('');
  const [cut, setCut] = useState('');
  const [due, setDue] = useState('');
  const isCard = kind === 'credit_card';

  const save = async () => {
    await createDebt({
      name: name.trim(), kind, balance: parseDigits(balance), monthlyPayment: parseDigits(payment),
      annualRatePct: Number(rate.replace(',', '.')) || 0, dueDay: day(due),
      cutDay: isCard ? day(cut) : null, creditLimit: isCard ? parseDigits(limit) || null : null,
    });
    router.back();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
        <ScreenHeader title="Nueva deuda" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {KINDS.map((k) => <Chip key={k} label={DEBT_KIND_LABEL[k]} selected={kind === k} onPress={() => setKind(k)} />)}
        </View>
        <Field label="Nombre" value={name} onChangeText={setName} placeholder={isCard ? 'Ej. Nu, Bancolombia Visa' : 'Ej. Crédito moto'} />
        {isCard && <MoneyField label="Cupo total de la tarjeta (COP)" value={limit} onChange={setLimit} />}
        <MoneyField label={isCard ? 'Saldo que ya debes en la tarjeta hoy (COP)' : 'Lo que debes hoy (COP)'} value={balance} onChange={setBalance} />
        {!isCard && <MoneyField label="Cuota mensual (COP)" value={payment} onChange={setPayment} />}
        <Field label="Tasa efectiva anual % (opcional)" value={rate} onChangeText={setRate} keyboardType="decimal-pad" placeholder="Ej. 28.5" />
        {isCard && <Field label="Día de corte (1-31)" value={cut} onChangeText={(t) => setCut(t.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" />}
        <Field label={isCard ? 'Día límite de pago (1-31)' : 'Día de pago (1-31)'} value={due} onChangeText={(t) => setDue(t.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" />
        {isCard && (
          <AppText variant="caption" color={colors.textSecondary}>
            Si ya tienes compras diferidas a cuotas en esta tarjeta, agrégalas después como "compra a cuotas" para que el calendario quede exacto.
          </AppText>
        )}
        <Button label="Guardar" onPress={save} disabled={!name.trim() || (isCard ? !parseDigits(limit) : !parseDigits(balance))} />
      </ScrollView>
    </SafeAreaView>
  );
}
