import React, { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Pressable, ScrollView, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NotificationListener, type SeenPackage } from '../modules/finzen-notifications';
import { AppText, Button, Card, Field, ScreenHeader } from '../src/components/ui';
import { getDb } from '../src/services/db';
import { syncWhitelist } from '../src/services/listener';
import {
  ensureListenerAlive, forceRebind, getHealth, openBatteryExemption, resetSenderBindings,
  setPersistentMode, setSenderBinding, type HealthSnapshot,
} from '../src/services/listenerHealth';
import { getSetting, setSetting, uid } from '../src/services/repo';
import { loadLockPrefs } from '../src/services/security';
import { SENDER_RULES } from '../src/services/senderRules';
import { ago } from '../src/services/timeAgo';
import { useTheme } from '../src/theme/ThemeProvider';

interface Source { id: string; label: string; kind: string; enabled: number; package_pattern: string; bound_package: string | null; user_added: number }
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isWhatsApp = (pkg: string) => /^com\.whatsapp(\.w4b)?$/.test(pkg);

export default function NotificationSources() {
  const { colors } = useTheme();
  const router = useRouter();
  const go = (path: string) => router.push(path as never);
  const [enabled, setEnabled] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [seen, setSeen] = useState<SeenPackage[]>([]);
  const [learning, setLearning] = useState(false);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [lockHint, setLockHint] = useState(false);
  const [needName, setNeedName] = useState(false);
  const [nameInput, setNameInput] = useState('');

  const load = useCallback(async () => {
    setEnabled(NotificationListener.isEnabled());
    const [lockPrefs, hintDismissed] = await Promise.all([loadLockPrefs(), getSetting('security_hint_dismissed')]);
    setLockHint(!lockPrefs.enabled && hintDismissed !== '1');
    setNeedName(!(await getSetting('owner_name')));
    const hh = getHealth();
    setHealth(hh);
    if (hh) setLearning(hh.learningUntil > Date.now());
    const db = await getDb();
    setSources(await db.getAllAsync<Source>(
      'SELECT id,label,kind,enabled,package_pattern,bound_package,user_added FROM notification_sources ORDER BY user_added DESC, label',
    ));
    setSeen(NotificationListener.seenPackages());
  }, []);

  useEffect(() => {
    syncWhitelist().catch(() => {});
    ensureListenerAlive();
    load();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') { ensureListenerAlive(); load(); }
    });
    const t = setInterval(() => { setHealth(getHealth()); setSeen(NotificationListener.seenPackages()); }, 3000);
    return () => { sub.remove(); clearInterval(t); NotificationListener.setLearningMode(false); };
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
        await db.runAsync('DELETE FROM notification_sources WHERE id=? AND user_added=1', [id]);
        await syncWhitelist(); load();
      }},
    ]);
  };

  const covered = (pkg: string) => sources.some((s) => { try { return new RegExp(s.package_pattern).test(pkg.toLowerCase()); } catch { return false; } });

  const add = async (pkg: string) => {
    const db = await getDb();
    await db.runAsync(
      'INSERT OR IGNORE INTO notification_sources (id,label,kind,package_pattern,enabled,user_added,bound_package) VALUES (?,?,?,?,1,1,?)',
      [`user_${uid()}`, pkg, 'bank', `^${esc(pkg.toLowerCase())}$`, pkg],
    );
    await syncWhitelist(); load();
    if (SENDER_RULES[pkg] && !isWhatsApp(pkg)) {
      Alert.alert('Lectura limitada', `Solo se leerán mensajes de: ${SENDER_RULES[pkg]!.join(', ')}. Todo lo demás se descarta sin leerse.`);
    }
    if (isWhatsApp(pkg)) {
      Alert.alert('WhatsApp', 'Solo se leerán chats individuales de Addi y Sistecrédito. Cualquier otro chat o grupo se descarta sin leerse.');
    }
  };

  const h = health;
  const dead = !!h && h.enabled && !h.connected;

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

        {enabled && needName && (
          <Card style={{ borderColor: colors.warning }}>
            <AppText variant="subtitle">👤 ¿Cómo apareces en tus cuentas?</AppText>
            <AppText variant="caption" color={colors.textSecondary}>
              Escribe tu nombre como sale en Nu y en Nequi. Si en alguna app sales con menos palabras, agrega esa versión separada por punto y coma. Así FinZen reconoce las transferencias entre tus cuentas sin confundirlas con las de otras personas. Se guarda solo en este celular.
            </AppText>
            <Field label="Tu nombre" value={nameInput} onChangeText={setNameInput} autoCapitalize="words" placeholder="Ej.: Juan Carlos Perez Gomez; Juan Perez" />
            <Button label="Guardar" disabled={!nameInput.trim()} onPress={async () => { await setSetting('owner_name', nameInput.trim(), 'device'); setNeedName(false); }} />
            <Button variant="ghost" label="Ahora no" onPress={() => setNeedName(false)} />
          </Card>
        )}

        {enabled && lockHint && (
          <Card style={{ borderColor: colors.warning }}>
            <AppText variant="subtitle">🔐 Protege tus movimientos</AppText>
            <AppText variant="caption" color={colors.textSecondary}>
              FinZen va a leer notificaciones de tus bancos. Activa un PIN y la huella para que nadie más pueda abrir la app.
            </AppText>
            <Button label="Configurar PIN y huella" onPress={() => go('/security')} />
            <Button variant="ghost" label="Ahora no" onPress={() => { setSetting('security_hint_dismissed', '1', 'device').catch(() => {}); setLockHint(false); }} />
          </Card>
        )}

        {h && (
          <Card style={{ borderColor: dead ? colors.warning : colors.primary }}>
            <AppText variant="subtitle">Estado del lector: {h.connected ? '🟢 Conectado' : '🔴 Desconectado'}</AppText>
            <AppText variant="caption" color={colors.textSecondary}>
              Última notificación vista: {ago(h.lastEvent)}{'\n'}
              Última encolada: {ago(h.lastQueued)} · Pendientes: {h.queued}{'\n'}
              Batería: {h.ignoringBattery ? 'sin restricción ✅' : 'restringida ⚠️'}
              {h.rejectedPatterns > 0 ? `\nPatrones inválidos ignorados: ${h.rejectedPatterns}` : ''}
              {h.spoofBlocked > 0 ? `\nSuplantaciones bloqueadas: ${h.spoofBlocked}` : ''}
            </AppText>
            {dead && (
              <AppText variant="caption" color={colors.warning}>
                El sistema tiene el permiso, pero el servicio no está enlazado. Toca “Reconectar lector”.
              </AppText>
            )}
            <Button label="Reconectar lector" onPress={() => { forceRebind(); setTimeout(load, 1500); }} />
            {!h.ignoringBattery && (
              <Button variant="ghost" label="Quitar restricción de batería" onPress={openBatteryExemption} />
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
              <AppText>Modo persistente (aviso fijo)</AppText>
              <Switch value={h.persistent} onValueChange={(v) => { setPersistentMode(v); setTimeout(load, 500); }} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
              <AppText>Verificar remitente (WhatsApp)</AppText>
              <Switch value={h.senderBinding} onValueChange={(v) => { setSenderBinding(v); setTimeout(load, 300); }} />
            </View>
            {h.senderBinding && (
              <Button variant="ghost" label="Restablecer remitentes verificados" onPress={() => { resetSenderBindings(); load(); }} />
            )}
          </Card>
        )}

        <Card>
          <AppText variant="subtitle">Ayuda y herramientas</AppText>
          <Button variant="ghost" label="Guía paso a paso" onPress={() => go('/notification-help')} />
          <Button variant="ghost" label="Probar el lector con un texto" onPress={() => go('/notification-test')} />
          <Button variant="ghost" label="Remitentes y avisos" onPress={() => go('/notification-senders')} />
          <Button variant="ghost" label="Diagnóstico técnico" onPress={() => go('/notification-diagnostics')} />
        </Card>

        <Card style={{ borderColor: colors.primary }}>
          <AppText variant="subtitle" color={colors.primary}>Agregar una app</AppText>
          <AppText variant="caption" color={colors.textSecondary} style={{ marginBottom: 8 }}>
            1. Activa el Modo Aprendizaje (se apaga solo a los 10 min).{'\n'}
            2. Haz una transferencia de prueba en tu banco o recibe una notificación.{'\n'}
            3. Toca "Agregar" en la app que aparezca abajo. Se activa sola, sin más pasos.
          </AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            <AppText>Modo Aprendizaje</AppText>
            <Switch value={learning} onValueChange={(v) => { setLearning(v); NotificationListener.setLearningMode(v); load(); }} />
          </View>

          {seen.filter((p) => !covered(p.packageName)).slice(0, 25).map((p) => (
            <View key={p.packageName} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 12, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
              <View style={{ flex: 1 }}>
                <AppText variant="caption" style={{ fontWeight: 'bold' }}>{p.packageName}</AppText>
                <AppText variant="caption" color={colors.textSecondary}>{p.count} notificación(es)</AppText>
              </View>
              <Button variant="ghost" label="Agregar" onPress={() => add(p.packageName)} />
            </View>
          ))}
          {seen.length > 0 && <Button variant="ghost" label="Limpiar historial" onPress={() => { NotificationListener.clearSeen(); load(); }} />}
        </Card>

        <Card>
          <AppText variant="subtitle">Fuentes ({sources.length})</AppText>
          {sources.length === 0 && <AppText color={colors.textSecondary}>Aún no hay fuentes. Usa el Modo Aprendizaje.</AppText>}
          {sources.map((s) => (
            <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
              <View style={{ flex: 1 }}>
                <AppText>{s.label}{s.user_added ? '' : ' · predefinida'}</AppText>
                <AppText variant="caption" color={s.bound_package ? colors.success : colors.textSecondary}>
                  {s.bound_package ? `🔒 Vinculada a ${s.bound_package}` : 'Sin verificar (se vincula con la primera notificación válida)'}
                </AppText>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {!!s.user_added && (
                  <Pressable onPress={() => remove(s.id, s.label)}><AppText style={{ fontSize: 20 }}>🗑️</AppText></Pressable>
                )}
                <Switch value={!!s.enabled} onValueChange={(v) => toggle(s, v)} />
              </View>
            </View>
          ))}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}