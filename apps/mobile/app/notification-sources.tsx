import React, { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Pressable, ScrollView, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { parseNotification } from '@finzen/core';
import { NotificationListener, type SeenPackage } from '../modules/finzen-notifications';
import { AppText, Button, Card, Field, ScreenHeader } from '../src/components/ui';
import { getDb } from '../src/services/db';
import { syncWhitelist } from '../src/services/listener';
import { uid } from '../src/services/repo';
import { useTheme } from '../src/theme/ThemeProvider';

interface Source { id: string; label: string; kind: string; enabled: number; package_pattern: string; bound_package: string | null }
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default function NotificationSources() {
  const { colors } = useTheme();
  const [enabled, setEnabled] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [seen, setSeen] = useState<SeenPackage[]>([]);
  const [learning, setLearning] = useState(false);
  const [testText, setTestText] = useState('');

  const load = useCallback(async () => {
    setEnabled(NotificationListener.isEnabled());
    const db = await getDb();
    // Solo traemos las apps que TÚ agregaste
    setSources(await db.getAllAsync<Source>('SELECT id,label,kind,enabled,package_pattern,bound_package FROM notification_sources WHERE user_added=1 ORDER BY label'));
    setSeen(NotificationListener.seenPackages());
  }, []);

  useEffect(() => {
    load();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && load());
    return () => { sub.remove(); NotificationListener.setLearningMode(false); };
  }, [load]);

  const toggle = async (s: Source, on: boolean) => {
    const db = await getDb();
    await db.runAsync('UPDATE notification_sources SET enabled=? WHERE id=?', [on ? 1 : 0, s.id]);
    await syncWhitelist(); load();
  };

  const remove = async (id: string, label: string) => {
    Alert.alert('Eliminar app', `¿Seguro que quieres eliminar "${label}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: async () => {
        const db = await getDb();
        await db.runAsync('DELETE FROM notification_sources WHERE id=?', [id]);
        await syncWhitelist(); load();
      }}
    ]);
  };

  const covered = (pkg: string) => sources.some((s) => { try { return new RegExp(s.package_pattern).test(pkg.toLowerCase()); } catch { return false; } });

  const add = async (pkg: string) => {
    const db = await getDb();
    await db.runAsync('INSERT OR IGNORE INTO notification_sources (id,label,kind,package_pattern,enabled,user_added,bound_package) VALUES (?,?,?,?,1,1,?)',
      [`user_${uid()}`, pkg, 'bank', `^${esc(pkg.toLowerCase())}$`, pkg]);
    await syncWhitelist(); load();
  };

  const runTest = () => {
    const result = parseNotification(testText, 'bank');
    if (!result) {
      Alert.alert('❌ Descartada', 'El motor no pudo encontrar un monto o no reconoció si es gasto o ingreso.');
    } else {
      Alert.alert(
        '✅ Notificación Parseada',
        `Tipo: ${result.type === 'income' ? 'Ingreso (Suma)' : 'Gasto (Resta)'}\n` +
        `Monto: $${result.amount}\n` +
        `Comercio: ${result.merchant ?? 'No detectado'}\n` +
        `Método: ${result.paymentMethod}\n` +
        `¿Es pago de deuda?: ${result.isDebtPayment ? 'Sí' : 'No'}`
      );
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
        <ScreenHeader title="Lectura de notificaciones" />

        {!NotificationListener.available && (
          <Card style={{ borderColor: colors.warning }}>
            <AppText color={colors.warning}>Esta versión de la app no incluye el lector nativo.</AppText>
          </Card>
        )}

        <Card>
          <AppText variant="subtitle">Acceso al sistema: {enabled ? '✅ Activado' : '❌ Desactivado'}</AppText>
          {!enabled && (
            <>
              <AppText variant="caption" color={colors.textSecondary}>
                1) Pulsa “Abrir ajustes” y activa FinZen en la lista.{'\n'}
                2) Si el interruptor sale gris (Android 13+): vuelve, pulsa “Permitir ajustes restringidos” y repite el paso 1.
              </AppText>
              <Button label="Abrir ajustes de acceso" onPress={() => NotificationListener.openSettings()} />
              <Button variant="ghost" label="Permitir ajustes restringidos" onPress={() => NotificationListener.openAppSettings()} />
            </>
          )}
        </Card>

        <Card style={{ borderColor: colors.primary }}>
          <AppText variant="subtitle" color={colors.primary}>Configura tu lector</AppText>
          <AppText variant="caption" color={colors.textSecondary} style={{ marginBottom: 8 }}>
            1. Activa el Modo Aprendizaje.{'\n'}
            2. Abre tu banco (Nequi, Nu, etc.) o WhatsApp y haz una transferencia de prueba.{'\n'}
            3. Vuelve aquí y toca "Agregar" en la app que aparezca abajo.
          </AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            <AppText>Modo Aprendizaje</AppText>
            <Switch value={learning} onValueChange={(v) => { setLearning(v); NotificationListener.setLearningMode(v); load(); }} />
          </View>
          
          {seen.filter((p) => !covered(p.packageName)).slice(0, 25).map((p) => (
            <View key={p.packageName} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 12, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
              <View style={{ flex: 1 }}>
                <AppText variant="caption" style={{fontWeight: 'bold'}}>{p.packageName}</AppText>
                <AppText variant="caption" color={colors.textSecondary}>{p.count} notificación(es)</AppText>
              </View>
              <Button variant="ghost" label="Agregar" onPress={() => add(p.packageName)} />
            </View>
          ))}
          {learning && <Button variant="ghost" label="Actualizar lista" onPress={load} />}
          {seen.length > 0 && <Button variant="ghost" label="Limpiar historial" onPress={() => { NotificationListener.clearSeen(); load(); }} />}
        </Card>

        <Card>
          <AppText variant="subtitle">Tus apps configuradas ({sources.length})</AppText>
          {sources.length === 0 && <AppText color={colors.textSecondary}>Aún no has agregado ninguna app. Usa el Modo Aprendizaje.</AppText>}
          {sources.map((s) => (
            <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
              <View style={{ flex: 1 }}>
                <AppText>{s.label}</AppText>
                <AppText variant="caption" color={s.bound_package ? colors.success : colors.textSecondary}>
                  {s.bound_package ? `🔒 Vinculada` : 'Sin verificar'}
                </AppText>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Pressable onPress={() => remove(s.id, s.label)}><AppText style={{ fontSize: 20 }}>🗑️</AppText></Pressable>
                <Switch value={!!s.enabled} onValueChange={(v) => toggle(s, v)} />
              </View>
            </View>
          ))}
        </Card>

        <Card style={{ borderColor: colors.primary }}>
          <AppText variant="subtitle">🧪 Simulador</AppText>
          <Field label="Texto de la notificación" value={testText} onChangeText={setTestText} placeholder="Ej. Recibiste 67,00..." />
          <Button label="Probar lectura" disabled={!testText.trim()} onPress={runTest} />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}