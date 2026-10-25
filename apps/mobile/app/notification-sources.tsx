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
interface Suspect { source_package: string; n: number }
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Lista blanca de apps cuyas notificaciones lee FinZen + "modo aprendizaje":
 * muestra de qué apps llegan notificaciones (solo el nombre del paquete, nunca el contenido)
 * para que agregues tu banco con un toque si no está en la lista.
 */
export default function NotificationSources() {
  const { colors } = useTheme();
  const [enabled, setEnabled] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [seen, setSeen] = useState<SeenPackage[]>([]);
  const [learning, setLearning] = useState(false);
  const [suspects, setSuspects] = useState<Suspect[]>([]);
  
  // Estados para el simulador de pruebas
  const [testText, setTestText] = useState('');

  const load = useCallback(async () => {
    setEnabled(NotificationListener.isEnabled());
    const db = await getDb();
    setSources(await db.getAllAsync<Source>('SELECT id,label,kind,enabled,package_pattern,bound_package FROM notification_sources ORDER BY user_added, label'));
    setSuspects(await db.getAllAsync<Suspect>("SELECT source_package, COUNT(*) AS n FROM notifications_log WHERE outcome='discarded_not_whitelisted' GROUP BY source_package ORDER BY n DESC LIMIT 10"));
    setSeen(NotificationListener.seenPackages());
  }, []);

  useEffect(() => {
    load();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && load()); // al volver de Ajustes del sistema
    return () => { sub.remove(); NotificationListener.setLearningMode(false); };
  }, [load]);

  const toggle = async (s: Source, on: boolean) => {
    const db = await getDb();
    await db.runAsync('UPDATE notification_sources SET enabled=? WHERE id=?', [on ? 1 : 0, s.id]);
    await syncWhitelist(); load();
  };

  // NUEVO: Función para eliminar definitivamente una app de la lista
  const remove = async (id: string, label: string) => {
    Alert.alert('Eliminar app', `¿Seguro que quieres eliminar "${label}" de la lista?`, [
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

  // NUEVO: Función que simula el parser con el texto que escriba el usuario
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
            <AppText variant="caption" color={colors.textSecondary}>Instala la versión más reciente del APK de FinZen.</AppText>
          </Card>
        )}

        <Card>
          <AppText variant="subtitle">Acceso a notificaciones: {enabled ? '✅ activado' : '❌ desactivado'}</AppText>
          {!enabled && (
            <>
              <AppText variant="caption" color={colors.textSecondary}>
                1) Pulsa “Abrir ajustes” y activa FinZen en la lista.{'\n'}
                2) Si el interruptor sale gris (Android 13 o superior, app instalada desde un APK): vuelve, pulsa “Permitir ajustes restringidos”,
                toca ⋮ arriba a la derecha → “Permitir ajustes restringidos”, y repite el paso 1.
              </AppText>
              <Button label="Abrir ajustes de acceso a notificaciones" onPress={() => NotificationListener.openSettings()} />
              <Button variant="ghost" label="Permitir ajustes restringidos" onPress={() => NotificationListener.openAppSettings()} />
            </>
          )}
          <AppText variant="caption" color={colors.textSecondary}>
            FinZen solo lee las apps marcadas abajo. Descarta automáticamente los mensajes con códigos de verificación y oculta números de tarjeta, cuenta y teléfono antes de guardar nada.
          </AppText>
        </Card>

        <Card>
          <AppText variant="subtitle">Apps permitidas</AppText>
          {sources.map((s) => (
            <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <AppText>{s.label}</AppText>
                <AppText variant="caption" color={colors.textSecondary}>{s.kind === 'bnpl' ? 'Compras a cuotas' : s.kind === 'wallet' ? 'Billetera' : 'Banco'}</AppText>
                <AppText variant="caption" color={s.bound_package ? colors.success : colors.textSecondary}>
                  {s.bound_package ? `🔒 Verificada: ${s.bound_package}` : 'Aún sin verificar (se fija con la primera notificación real)'}
                </AppText>
                {s.bound_package ? (
                  <Pressable onPress={async () => { const db = await getDb(); await db.runAsync('UPDATE notification_sources SET bound_package=NULL WHERE id=?', [s.id]); load(); }}>
                    <AppText variant="caption" color={colors.primary}>Desvincular (si cambiaste de app del banco)</AppText>
                  </Pressable>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {/* NUEVO BOTÓN PARA ELIMINAR */}
                <Pressable onPress={() => remove(s.id, s.label)}>
                  <AppText style={{ fontSize: 20 }}>🗑️</AppText>
                </Pressable>
                <Switch value={!!s.enabled} onValueChange={(v) => toggle(s, v)} />
              </View>
            </View>
          ))}
        </Card>

        {suspects.length > 0 && (
          <Card style={{ borderColor: colors.warning }}>
            <AppText variant="subtitle" color={colors.warning}>⚠ Notificaciones ignoradas por parecerse a un banco</AppText>
            <AppText variant="caption" color={colors.textSecondary}>
              Estas apps tienen un nombre parecido al de uno de tus bancos pero NO son la app verificada. FinZen las ignoró. Si no las reconoces, desinstálalas.
            </AppText>
            {suspects.map((x) => <AppText key={x.source_package} variant="caption">{x.source_package} · {x.n} vez/veces</AppText>)}
          </Card>
        )}

        <Card>
          <AppText variant="subtitle">¿Tu banco no aparece o no llega nada?</AppText>
          <AppText variant="caption" color={colors.textSecondary}>
            Activa el modo aprendizaje, haz una compra o espera una notificación de tu banco, y vuelve aquí: verás de qué apps llegaron (solo el nombre, nunca el texto). Toca “Agregar” en la de tu banco.
          </AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <AppText>Modo aprendizaje</AppText>
            <Switch value={learning} onValueChange={(v) => { setLearning(v); NotificationListener.setLearningMode(v); load(); }} />
          </View>
          {seen.filter((p) => !covered(p.packageName)).slice(0, 25).map((p) => (
            <View key={p.packageName} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <AppText variant="caption">{p.packageName}</AppText>
                <AppText variant="caption" color={colors.textSecondary}>{p.count} notificación(es)</AppText>
              </View>
              <Button variant="ghost" label="Agregar" onPress={() => add(p.packageName)} />
            </View>
          ))}
          {learning && <Button variant="ghost" label="Actualizar lista" onPress={load} />}
          {seen.length > 0 && <Button variant="ghost" label="Borrar lista de apps vistas" onPress={() => { NotificationListener.clearSeen(); load(); }} />}
        </Card>

        {/* NUEVO: SIMULADOR DE NOTIFICACIONES */}
        <Card style={{ borderColor: colors.primary }}>
          <AppText variant="subtitle">🧪 Simulador de Pruebas</AppText>
          <AppText variant="caption" color={colors.textSecondary} style={{ marginBottom: 8 }}>
            Pega aquí una notificación falsa (de Bancolombia, Nequi, etc.) y comprueba si el motor la lee correctamente sin gastar dinero.
          </AppText>
          <Field 
            label="Texto de la notificación" 
            value={testText} 
            onChangeText={setTestText} 
            placeholder="Ej. Bancolombia: Compraste $50.000 en Éxito" 
          />
          <Button 
            label="Probar lectura" 
            disabled={!testText.trim()} 
            onPress={runTest} 
          />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}