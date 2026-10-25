import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Button, Card, Chip, Field, ScreenHeader } from '../src/components/ui';
import { useFocusData } from '../src/hooks/useFocusData';
import { addRule, deleteRule, listCategories, listRules } from '../src/services/transactions';
import { useTheme } from '../src/theme/ThemeProvider';

/** Reglas propias: "si el comercio contiene 'rappi' → Comida › Domicilio". Ganan a las predefinidas. */
export default function Rules() {
  const { colors } = useTheme();
  const [rules, reload] = useFocusData(listRules, []);
  const [cats] = useFocusData(listCategories, []);
  const [pattern, setPattern] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const name = (id: string) => {
    const c = cats.find((x) => x.id === id);
    const p = c?.parent_id ? cats.find((x) => x.id === c.parent_id) : null;
    return p ? `${p.name} › ${c?.name}` : c?.name ?? id;
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }} keyboardShouldPersistTaps="handled">
        <ScreenHeader title="Reglas de categoría" />
        {rules.map((r) => (
          <Card key={r.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flexShrink: 1 }}>
              <AppText>Contiene “{r.pattern}”</AppText>
              <AppText variant="caption" color={colors.textSecondary}>→ {name(r.categoryId)}</AppText>
            </View>
            <Pressable onPress={async () => { await deleteRule(r.id); reload(); }}><AppText color={colors.danger}>Quitar</AppText></Pressable>
          </Card>
        ))}
        <Card>
          <Field label="Si el comercio contiene…" value={pattern} onChangeText={setPattern} placeholder="Ej. rappi" autoCapitalize="none" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {cats.filter((c) => c.kind === 'expense').map((c) => (
              <Chip key={c.id} label={name(c.id)} selected={categoryId === c.id} onPress={() => setCategoryId(c.id)} />
            ))}
          </View>
          <Button label="Agregar regla" disabled={!pattern.trim() || !categoryId}
            onPress={async () => { await addRule(pattern, categoryId!); setPattern(''); reload(); }} />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
