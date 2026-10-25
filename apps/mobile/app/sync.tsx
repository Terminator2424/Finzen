import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Button, Card, Field, InfoRow, ScreenHeader } from '../src/components/ui';
import { getSetting } from '../src/services/repo';
import {
  deleteRemoteData, getSyncConfig, isSignedIn, lastSyncAt, pendingCount, saveSyncConfig, signIn, signOut, signUp, syncNow,
} from '../src/services/sync';
import { useTheme } from '../src/theme/ThemeProvider';

export default function Sync() {
  const { colors } = useTheme();
  const [url, setUrl] = useState('');
  const [anon, setAnon] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signed, setSigned] = useState(false);
  const [pending, setPending] = useState(0);
  const [last, setLast] = useState<number | null>(null);
  const [lastError, setLastError] = useState('');
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const cfg = await getSyncConfig();
    if (cfg) { setUrl(cfg.url); setAnon(cfg.anon); setEmail(cfg.email ?? ''); }
    setSigned(await isSignedIn());
    setPending(await pendingCount());
    setLast(await lastSyncAt());
    setLastError((await getSetting('sync_last_error')) ?? '');
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true); setMsg(null);
    try { const t = await fn(); if (t) setMsg({ text: t, ok: true }); }
    catch (e) { setMsg({ text: e instanceof Error ? e.message : String(e), ok: false }); }
    finally { setBusy(false); refresh(); }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
        <ScreenHeader title="Sincronización" />
        <AppText color={colors.textSecondary}>
          Opcional. FinZen guarda todo en tu celular y funciona sin internet. Aquí puedes respaldar en TU propio proyecto gratuito de Supabase y usar varios celulares.
          La guía paso a paso está en packages/supabase/README.md del repositorio.
        </AppText>

        <Card>
          <AppText variant="subtitle">1. Tu proyecto de Supabase</AppText>
          <Field label="Project URL" value={url} onChangeText={setUrl} autoCapitalize="none" placeholder="https://xxxx.supabase.co" />
          <Field label="Clave anon public (nunca la service_role)" value={anon} onChangeText={setAnon} autoCapitalize="none" secureTextEntry />
          <Button variant="ghost" label="Guardar conexión" disabled={busy || !url || !anon} onPress={() => run(async () => { await saveSyncConfig(url, anon); return '✓ Conexión guardada.'; })} />
        </Card>

        {!signed ? (
          <Card>
            <AppText variant="subtitle">2. Tu cuenta</AppText>
            <Field label="Correo" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
            <Field label="Contraseña (mínimo 10 caracteres; no se guarda en el celular)" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
            <Button label="Iniciar sesión" disabled={busy || !email || !password} onPress={() => run(async () => { await signIn(email, password); setPassword(''); return '✓ Sesión iniciada.'; })} />
            <Button variant="ghost" label="Crear cuenta nueva" disabled={busy || !email || password.length < 10} onPress={() => run(async () => { const t = await signUp(email, password); setPassword(''); return t; })} />
          </Card>
        ) : (
          <Card>
            <AppText variant="subtitle">Estado</AppText>
            <InfoRow label="Cuenta" value={email || '—'} />
            <InfoRow label="Cambios pendientes de subir" value={String(pending)} />
            <InfoRow label="Última sincronización" value={last ? new Date(last).toLocaleString('es-CO') : 'Nunca'} />
            {lastError ? <AppText variant="caption" color={colors.danger}>Último error: {lastError}</AppText> : null}
            <Button label={busy ? 'Sincronizando…' : 'Sincronizar ahora'} disabled={busy}
              onPress={() => run(async () => { const r = await syncNow(); return `✓ Subidos ${r.pushed}, descargados ${r.pulled}.`; })} />
            <Button variant="ghost" label="Cerrar sesión" onPress={() => run(async () => { await signOut(); return 'Sesión cerrada. Tus datos siguen en el celular.'; })} />
            <Button variant="ghost" label="Borrar mis datos de la nube"
              onPress={() => Alert.alert('Borrar datos de la nube', 'Se borrarán de Supabase todas tus transacciones, deudas y cuentas. En el celular no se borra nada. ¿Continuar?', [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Borrar', style: 'destructive', onPress: () => run(async () => { await deleteRemoteData(); return '✓ Datos borrados de la nube.'; }) },
              ])} />
          </Card>
        )}
        {msg && <AppText color={msg.ok ? colors.success : colors.danger}>{msg.text}</AppText>}
      </ScrollView>
    </SafeAreaView>
  );
}
