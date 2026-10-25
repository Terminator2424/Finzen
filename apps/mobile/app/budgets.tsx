import React, { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Button, Card, MoneyField, ScreenHeader } from '../src/components/ui';
import { budgetAmounts, listCategories, setBudget } from '../src/services/transactions';
import { useTheme } from '../src/theme/ThemeProvider';
import { groupDigits, parseDigits } from '../src/utils/format';

/** Presupuesto mensual por categoría de primer nivel. 0 o vacío = sin presupuesto. */
export default function Budgets() {
  const { colors } = useTheme();
  const [cats, setCats] = useState<{ id: string; name: string }[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const all = (await listCategories()).filter((c) => !c.parent_id && c.kind === 'expense' && c.id !== 'cat_deudas');
      const amounts = await budgetAmounts();
      setCats(all);
      setValues(Object.fromEntries(all.map((c) => [c.id, amounts.get(c.id) ? groupDigits(String(amounts.get(c.id))) : ''])));
    })();
  }, []);

  const save = async () => {
    for (const c of cats) await setBudget(c.id, parseDigits(values[c.id] ?? ''));
    setSaved(true);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }} keyboardShouldPersistTaps="handled">
        <ScreenHeader title="Presupuestos" />
        <AppText color={colors.textSecondary}>Cuánto quieres gastar al mes en cada categoría. Te aviso en el Inicio al llegar al 80 %.</AppText>
        <Card>
          {cats.map((c) => (
            <View key={c.id}>
              <MoneyField label={c.name} value={values[c.id] ?? ''} onChange={(v) => { setSaved(false); setValues((s) => ({ ...s, [c.id]: v })); }} />
            </View>
          ))}
        </Card>
        <Button label={saved ? '✓ Guardado' : 'Guardar presupuestos'} onPress={save} />
      </ScrollView>
    </SafeAreaView>
  );
}
