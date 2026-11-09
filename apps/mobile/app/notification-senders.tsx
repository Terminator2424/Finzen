import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, Switch, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Button, Card, Chip, Field, ScreenHeader } from '../src/components/ui';
import { CONFIRM_KEY, confirmationsOn } from '../src/services/autoNotify';
import { setSenderRules } from '../src/services/listenerHealth';
import { setSetting } from '../src/services/repo';
import { forNative, getSenderRules, normalizeSender, resetSenderRules, saveSenderRules } from '../src/services/senderRules';
import { useTheme } from '../src/theme/ThemeProvider';

const LABEL: Record<string, string> = {
  'com.google.android.apps.messages': 'Mensajes de Google (SMS)',
  'com.samsung.android.messaging': 'Mensajes de Samsung (SMS)',
};

export default function NotificationSenders() {
  const { colors } = useTheme();
  const [rules, setRules] = useState<Record<string, string[]>>({});
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(true);

  const load = useCallback(async () => {
    setRules(await getSenderRules());
    setConfirm(await confirmationsOn());
  }, []);
  useFocusEffect(useCallback(() => { load().catch(() => {}); }, [load]));

  const fail = (e: unknown) => Alert.alert('No se pudo', e instanceof Error ? e.message : String(e));

  const persist = async (next: Record<string, string[]>) => {
    await saveSenderRules(next);
    setSenderRules(forNative(next)); // se envía de una vez al servicio nativo
    setRules(next);
  };

  const add = async (pkg: string) => {
    const s = normalizeSender(inputs[pkg] ?? '');
    if (!s) {
      Alert.alert('Remitente no válido', 'Escribe una sola palabra de 3 a 20 letras o números, como sale al inicio del título del aviso (por ejemplo: tigo).');
      return;
    }
    const cur = rules[pkg] ?? [];
    if (cur.includes(s)) { Alert.alert('Ya está en la lista', `"${s}" ya estaba permitido.`); return; }
    if (cur.length >= 10) { Alert.alert('Demasiados remitentes', 'El máximo es 10 por app.'); return; }
    try {
      await persist({ ...rules, [pkg]: [...cur, s] });
      setInputs((p) => ({ ...p, [pkg]: '' }));
    } catch (e) { fail(e); }
  };

  const remove = (pkg: string, s: string) => Alert.alert('Quitar remitente', `FinZen dejará de leer los avisos de "${s}" en ${LABEL[pkg] ?? pkg}.`, [
    { text: 'Cancelar', style: 'cancel' },
    {
      text: 'Quitar', style: 'destructive',
      onPress: async () => { try { await persist({ ...rules, [pkg]: (rules[pkg] ?? []).filter((x) => x !== s) }); } catch (e) { fail(e); } },
    },
  ]);

  const reset = () => Alert.alert('Restablecer', 'Se vuelve a la lista original de remitentes (Tigo).', [
    { text: 'Cancelar', style: 'cancel' },
    {
      text: 'Restablecer',
      onPress: async () => { try { await resetSenderRules(); const r = await getSenderRules(); setSenderRules(forNative(r)); setRules(r); } catch (e) { fail(e); } },
    },
  ]);

  const toggleConfirm = async (v: boolean) => {
    setConfirm(v);
    await setSetting(CONFIRM_KEY, v ? '1' : '0', 'device');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
        <ScreenHeader title="Remitentes y avisos" />

        <Card>
          <AppText variant="subtitle">Avisos de FinZen</AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <AppText>Avisarme cuando registre algo</AppText>
              <AppText variant="caption" color={colors.textSecondary}>
                Muestra el monto con un botón Deshacer. Si no quieres verlo en la pantalla bloqueada, apágalo.
              </AppText>
            </View>
            <Switch value={confirm} onValueChange={toggleConfirm} />
          </View>
        </Card>

        <AppText color={colors.textSecondary}>
          En los SMS llegan mensajes de muchos remitentes. FinZen solo lee los de esta lista y descarta todo lo demás sin leerlo.
          Un remitente es la primera palabra del título del aviso.
        </AppText>

        {Object.keys(rules).sort().map((pkg) => (
          <Card key={pkg}>
            <AppText variant="subtitle">{LABEL[pkg] ?? pkg}</AppText>
            {(rules[pkg] ?? []).length === 0 ? (
              <AppText variant="caption" color={colors.warning}>Sin remitentes: no se lee nada de esta app.</AppText>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {(rules[pkg] ?? []).map((s) => <Chip key={s} label={`${s} ✕`} selected={false} onPress={() => remove(pkg, s)} />)}
              </View>
            )}
            <Field
              label="Agregar remitente" value={inputs[pkg] ?? ''} autoCapitalize="none" placeholder="Ej.: bancolombia"
              onChangeText={(t) => setInputs((p) => ({ ...p, [pkg]: t }))}
            />
            <Button variant="ghost" label="Agregar" disabled={!(inputs[pkg] ?? '').trim()} onPress={() => add(pkg)} />
          </Card>
        ))}

        <Button variant="ghost" label="Restablecer remitentes originales" onPress={reset} />
      </ScrollView>
    </SafeAreaView>
  );
}