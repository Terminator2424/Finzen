import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Button, Card, Field, MoneyField, ScreenHeader } from '../src/components/ui';
import { useFocusData } from '../src/hooks/useFocusData';
import { addRecurring, deleteRecurring, listRecurring } from '../src/services/recurring';
import { useTheme } from '../src/theme/ThemeProvider';
import { formatCOP, parseDigits } from '../src/utils/format';

export default function RecurringScreen() {
  const { colors } = useTheme();
  const [items, reload] = useFocusData(listRecurring, []);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState('');
  const [saving, setSaving] = useState(false);

  const total = items.reduce((s, i) => s + i.amount, 0);

  const save = async () => {
    const v = parseDigits(amount);
    const d = parseInt(day, 10);
    if (!name.trim() || !v || !d || d < 1 || d > 31) {
      Alert.alert('Datos inválidos', 'Asegúrate de poner un nombre, un monto mayor a 0 y un día del 1 al 31.');
      return;
    }
    setSaving(true);
    try {
      await addRecurring(name.trim(), v, d, null);
      setName(''); setAmount(''); setDay('');
      reload();
    } finally { setSaving(false); }
  };

  const remove = (id: string, label: string) => {
    Alert.alert('Eliminar gasto fijo', `¿Eliminar "${label}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: async () => { await deleteRecurring(id); reload(); } }
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }} keyboardShouldPersistTaps="handled">
        <ScreenHeader title="Gastos Fijos" />
        <AppText color={colors.textSecondary}>
          Registra tus pagos recurrentes (arriendo, Netflix, internet) para saber cuánto dinero de tu mes ya está comprometido.
        </AppText>

        <Card style={{ backgroundColor: colors.surface }}>
          <AppText variant="subtitle">Total comprometido al mes</AppText>
          <AppText variant="big" color={colors.primary}>{formatCOP(total)}</AppText>
        </Card>

        {items.map((i) => (
          <Card key={i.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <AppText>{i.name}</AppText>
              <AppText variant="caption" color={colors.textSecondary}>Se cobra el día {i.day_of_month} de cada mes</AppText>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 8 }}>
              <AppText color={colors.danger}>{formatCOP(i.amount)}</AppText>
              <Pressable onPress={() => remove(i.id, i.name)}>
                <AppText variant="caption" color={colors.danger}>Eliminar 🗑️</AppText>
              </Pressable>
            </View>
          </Card>
        ))}

        <Card>
          <AppText variant="subtitle">Agregar nuevo</AppText>
          <Field label="Nombre (ej. Netflix, Arriendo)" value={name} onChangeText={setName} />
          <MoneyField label="Monto mensual (COP)" value={amount} onChange={setAmount} />
          <Field label="Día de cobro (1-31)" value={day} onChangeText={setDay} placeholder="Ej. 15" keyboardType="numeric" />
          <Button label="Guardar gasto fijo" disabled={saving} onPress={save} />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}