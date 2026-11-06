import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Constants from 'expo-constants';
import { useRouter, type Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NotificationListener } from '../../modules/finzen-notifications';
import { AppText, Card, Chip, InfoRow } from '../../src/components/ui';
import { useFocusData } from '../../src/hooks/useFocusData';
import { getDb, isDbEncrypted } from '../../src/services/db';
import { getSetting } from '../../src/services/repo';
import { isSignedIn, lastSyncAt, pendingCount } from '../../src/services/sync';
import { PALETTES, type ModePreference, type PaletteId } from '../../src/theme/palettes';
import { useTheme } from '../../src/theme/ThemeProvider';

const MODES: { id: ModePreference; label: string }[] = [
  { id: 'light', label: 'Claro' }, { id: 'dark', label: 'Oscuro' }, { id: 'auto', label: 'Automático' },
];

async function diagnostics() {
  const db = await getDb();
  const q = (sql: string) => db.getFirstAsync<{ n: number }>(sql).then((r) => r?.n ?? 0);
  const last = await lastSyncAt();
  return {
    version: (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0,
    queue: await pendingCount(),
    tx: await q('SELECT COUNT(*) AS n FROM transactions WHERE deleted_at IS NULL'),
    synced: await isSignedIn(),
    lastBackup: Number((await getSetting('last_backup_at')) ?? 0) || null,
    last,
    encrypted: isDbEncrypted(),
    listener: NotificationListener.available ? (NotificationListener.isEnabled() ? 'Activado' : 'Desactivado') : 'No disponible en esta versión',
  };
}

function backupHint(last: number | null): string {
  if (!last) return '⚠ Nunca hiciste un respaldo. Si pierdes el celular, pierdes tus datos.';
  const days = Math.floor((Date.now() - last) / 86_400_000);
  if (days >= 30) return `⚠ Tu último respaldo fue hace ${days} días. Haz uno nuevo.`;
  return `Último respaldo: hace ${days === 0 ? 'menos de un día' : `${days} día(s)`}.`;
}

export default function Settings() {
  const { colors, paletteId, mode, setPalette, setMode } = useTheme();
  const router = useRouter();
  const [diag] = useFocusData(diagnostics, { version: 0, queue: 0, tx: 0, synced: false, last: null as number | null, lastBackup: null as number | null, listener: '—', encrypted: true });

  const link = (label: string, path: string, hint?: string) => (
    <Pressable key={path} onPress={() => router.push(path as Href)} style={{ paddingVertical: 8 }}>
      <AppText color={colors.primary}>{label} ›</AppText>
      {hint ? <AppText variant="caption" color={colors.textSecondary}>{hint}</AppText> : null}
    </Pressable>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
        <AppText variant="title">Ajustes</AppText>

        <Card>
          <AppText variant="subtitle">Paleta</AppText>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(Object.keys(PALETTES) as PaletteId[]).map((id) => (
              <Chip key={id} label={PALETTES[id].label} selected={paletteId === id} onPress={() => setPalette(id)} />
            ))}
          </View>
        </Card>
        <Card>
          <AppText variant="subtitle">Modo</AppText>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {MODES.map((m) => <Chip key={m.id} label={m.label} selected={mode === m.id} onPress={() => setMode(m.id)} />)}
          </View>
        </Card>

        <Card>
          <AppText variant="subtitle">Captura automática</AppText>
          {link('Lectura de notificaciones', '/notification-sources', `Estado: ${diag.listener}. Elige qué bancos y billeteras lee FinZen.`)}
          {link('Probar notificaciones', '/notification-test', 'Pega el texto de una notificación y mira cómo la interpreta FinZen.')}
          {link('Reglas de categorización', '/rules')}
        </Card>

        <Card>
          <AppText variant="subtitle">Finanzas</AppText>
          {link('Cuentas y activos', '/accounts')}
          {link('Transferir entre mis cuentas', '/transfer')}
          {link('Me deben (cuentas por cobrar)', '/receivables')}
          {link('Presupuestos mensuales', '/budgets')}
          {link('Gastos fijos y suscripciones', '/recurring')}
          {link('Escanear un recibo', '/scan')}
        </Card>

        <Card>
          <AppText variant="subtitle">Seguridad y datos</AppText>
          {link('Bloqueo con huella y PIN', '/security')}
          {link('Exportar, importar y borrar datos', '/data', backupHint(diag.lastBackup))}
          {link('Sincronización en la nube (opcional)', '/sync', diag.synced ? 'Conectada' : 'Desconectada: tus datos solo están en este celular.')}
          {link('Configurar IA del asistente', '/assistant-settings')}
        </Card>

        <Card>
          <AppText variant="subtitle">Diagnóstico</AppText>
          <InfoRow label="Versión de la app" value={Constants.expoConfig?.version ?? '-'} />
          <InfoRow label="Versión de la base de datos" value={String(diag.version)} />
          <InfoRow label="Base de datos" value={diag.encrypted ? 'Cifrada (AES-256)' : '⚠ SIN CIFRAR'} color={diag.encrypted ? colors.success : colors.danger}/>
          <InfoRow label="Transacciones" value={String(diag.tx)} />
          <InfoRow label="Lector de notificaciones" value={diag.listener} />
          <InfoRow label="Sincronización" value={diag.synced ? 'Conectada' : 'No configurada'} />
          {diag.synced && <InfoRow label="Cambios por subir" value={String(diag.queue)} />}
          {diag.last ? <InfoRow label="Última sincronización" value={new Date(diag.last).toLocaleString('es-CO')} /> : null}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}