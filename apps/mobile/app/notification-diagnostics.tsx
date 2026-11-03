import React, { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Button, Card, ScreenHeader } from '../src/components/ui';
import { drainAndIngest, ingestLog, syncWhitelist } from '../src/services/listener';
import { forceRebind, getHealth, getTrace } from '../src/services/listenerHealth';
import { ago } from '../src/services/timeAgo';
import { useTheme } from '../src/theme/ThemeProvider';

export default function NotificationDiagnostics() {
  const { colors } = useTheme();
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 2000);
    return () => clearInterval(t);
  }, []);

  const h = getHealth();
  const trace = getTrace().slice(-12).reverse();
  const log = ingestLog.slice(-12).reverse();
  const muted = colors.textSecondary;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
        <ScreenHeader title="Diagnóstico técnico" />

        <Card>
          <AppText variant="subtitle">Estado</AppText>
          {h ? (
            <AppText variant="caption" color={muted}>
              Android {h.sdk} · {h.manufacturer}{'\n'}
              Permiso: {h.enabled ? 'sí' : 'no'} · Conectado: {h.connected ? 'sí' : 'no'}{'\n'}
              Último enganche: {ago(h.lastConnected)} · Último desenganche: {ago(h.lastDisconnected)}{'\n'}
              Última vista: {ago(h.lastEvent)} · Última encolada: {ago(h.lastQueued)}{'\n'}
              Pendientes: {h.queued} · Batería sin restricción: {h.ignoringBattery ? 'sí' : 'no'}{'\n'}
              Patrones inválidos: {h.rejectedPatterns} · Suplantaciones bloqueadas: {h.spoofBlocked}
              {h.lastError ? `\nÚltimo error: ${h.lastError} (${ago(h.lastErrorAt)})` : ''}
            </AppText>
          ) : (
            <AppText variant="caption" color={muted}>El módulo nativo no está disponible en esta versión.</AppText>
          )}
          <Button variant="ghost" label="Reconectar lector" onPress={forceRebind} />
        </Card>

        <Card>
          <AppText variant="subtitle">Filtro nativo</AppText>
          <AppText variant="caption" color={muted}>Qué decidió el servicio con cada notificación (solo paquete y motivo, nunca el contenido).</AppText>
          {trace.map((e, i) => (
            <AppText key={`t${i}`} variant="caption">{new Date(e.t).toLocaleTimeString()} {e.p} → {e.s}</AppText>
          ))}
          {trace.length === 0 && <AppText variant="caption">(vacío)</AppText>}
        </Card>

        <Card>
          <AppText variant="subtitle">Importación</AppText>
          {log.map((l, i) => (
            <AppText key={`l${i}`} variant="caption">{l}</AppText>
          ))}
          {log.length === 0 && <AppText variant="caption">(vacío)</AppText>}
          <Button variant="ghost" label="Importar cola ahora" onPress={() => { drainAndIngest().catch(() => {}); }} />
          <Button variant="ghost" label="Sincronizar lista blanca" onPress={() => { syncWhitelist().catch(() => {}); }} />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}