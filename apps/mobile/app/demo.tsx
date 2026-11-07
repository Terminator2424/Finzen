import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, Switch, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Button, Card, ScreenHeader } from '../src/components/ui';
import { isDemoLoaded, loadDemo, removeDemo } from '../src/services/demo';
import { loadLockPrefs, saveLockPref } from '../src/services/security';
import { isSignedIn } from '../src/services/sync';
import { useTheme } from '../src/theme/ThemeProvider';

export default function Demo() {
  const { colors } = useTheme();
  const [loaded, setLoaded] = useState(false);
  const [capture, setCapture] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoaded(await isDemoLoaded());
    setCapture(!(await loadLockPrefs()).secureScreen);
  }, []);
  useFocusEffect(useCallback(() => { load().catch(() => {}); }, [load]));

  const fail = (e: unknown) => Alert.alert('No se pudo', e instanceof Error ? e.message : String(e));

  const onLoad = async () => {
    if (busy) return;
    if (await isSignedIn()) {
      Alert.alert('Nube conectada', 'Desconecta la sincronización antes de cargar los datos de ejemplo: no queremos subirlos a tu nube.');
      return;
    }
    setBusy(true);
    setMsg(null);
    try { await loadDemo(); setMsg('✓ Datos de ejemplo cargados. Revisa Inicio.'); await load(); } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const onRemove = () => Alert.alert('Quitar datos de ejemplo', 'Se borran solo los datos de ejemplo. Tus datos reales no se tocan.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Quitar', style: 'destructive', onPress: async () => { try { await removeDemo(); setMsg('✓ Datos de ejemplo quitados.'); await load(); } catch (e) { fail(e); } } },
  ]);

  const toggleCapture = async (v: boolean) => {
    setCapture(v);
    await saveLockPref('secure_screen', v ? '0' : '1');
    setMsg('Guardado. Si no se aplica de inmediato, cierra y abre FinZen.');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
        <ScreenHeader title="Modo demo" />
        <AppText color={colors.textSecondary}>
          Datos de ejemplo para grabar el video o tomar capturas sin mostrar tus finanzas reales. La demo no se mezcla con datos reales: solo se carga con la base vacía.
        </AppText>

        <Card style={{ borderColor: loaded ? colors.primary : colors.border }}>
          <AppText variant="subtitle">{loaded ? '🎬 Datos de ejemplo cargados' : 'Sin datos de ejemplo'}</AppText>
          {loaded ? (
            <Button label="Quitar datos de ejemplo" onPress={onRemove} disabled={busy} />
          ) : (
            <Button label="Cargar datos de ejemplo" onPress={onLoad} disabled={busy} />
          )}
        </Card>

        <Card>
          <AppText variant="subtitle">Para grabar sin exponer tus datos</AppText>
          <AppText variant="caption" color={colors.textSecondary}>
            1. Haz un respaldo cifrado (Ajustes → Exportar, importar y borrar datos) y guárdalo fuera del celular.{'\n'}
            2. En esa misma pantalla, usa "Borrar todos los datos".{'\n'}
            3. Vuelve aquí y toca "Cargar datos de ejemplo".{'\n'}
            4. Graba. Al terminar, toca "Quitar datos de ejemplo" y restaura tu respaldo.{'\n'}
            Mientras grabas, los avisos reales que lleguen se mezclarían con la demo: apaga el lector o no uses tus apps de pago.
          </AppText>
        </Card>

        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <AppText>Permitir capturas y grabación</AppText>
              <AppText variant="caption" color={colors.textSecondary}>Por defecto la app las bloquea. Vuelve a apagarlo al terminar.</AppText>
            </View>
            <Switch value={capture} onValueChange={toggleCapture} />
          </View>
        </Card>

        {!!msg && <AppText color={colors.success}>{msg}</AppText>}
      </ScrollView>
    </SafeAreaView>
  );
}