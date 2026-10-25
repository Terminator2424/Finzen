import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LockProvider } from '../src/components/LockProvider';
import { cleanTempFiles } from '../src/services/backup';
import { getDb } from '../src/services/db';
import { startListenerBridge } from '../src/services/listener';
import { rescheduleReminders } from '../src/services/reminders';
import { getSetting } from '../src/services/repo';
import { loadLockPrefs, type LockPrefs } from '../src/services/security';
import { autoSync } from '../src/services/sync';
import { PALETTES, type ModePreference, type PaletteId } from '../src/theme/palettes';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';

interface Boot { palette: PaletteId; mode: ModePreference; lock: LockPrefs }

/**
 * Si algo falla al dibujar una pantalla, en vez de quedarse en blanco se muestra el error
 * (y se puede copiar para reportarlo).
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 70, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: '700' }}>Algo salió mal</Text>
      <Text selectable style={{ color: '#B91C1C' }}>{error.message}</Text>
      <Text selectable style={{ fontSize: 11, color: '#6B7280' }}>{error.stack?.slice(0, 900)}</Text>
      <Pressable onPress={retry} style={{ backgroundColor: '#7C3AED', padding: 14, borderRadius: 12, alignItems: 'center' }}>
        <Text style={{ color: '#fff', fontWeight: '700' }}>Reintentar</Text>
      </Pressable>
    </ScrollView>
  );
}

function ThemedStack() {
  const { colors, isDark } = useTheme();
  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
    </>
  );
}

/** Servicios en segundo plano mientras la app está abierta. */
function useBackgroundServices() {
  useEffect(() => {
    const stopBridge = startListenerBridge();          // lee notificaciones capturadas por el servicio nativo
    rescheduleReminders();                              // avisos de cuotas y pagos de tarjeta
    autoSync();                                         // sincroniza si el usuario conectó Supabase
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') { rescheduleReminders(); autoSync(); }
    });
    return () => { stopBridge(); sub.remove(); };
  }, []);
}

function Services({ children }: { children: React.ReactNode }) {
  useBackgroundServices();
  return <>{children}</>;
}

export default function RootLayout() {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Arranque: abrir BD (aplica migraciones) y leer tema y bloqueo antes de pintar,
  // así no hay parpadeo con la paleta por defecto ni un instante sin bloqueo.
  useEffect(() => {
    (async () => {
      try {
        await getDb();
        cleanTempFiles(); // borra restos de exportaciones, extractos y fotos de sesiones anteriores
        const p = await getSetting('palette');
        const m = await getSetting('mode');
        setBoot({
          palette: p && p in PALETTES ? (p as PaletteId) : 'purple',
          mode: m === 'light' || m === 'dark' || m === 'auto' ? m : 'auto',
          lock: await loadLockPrefs(),
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  if (error) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 8 }}>
        <Text style={{ fontWeight: '700', fontSize: 18 }}>No se pudo abrir la base de datos</Text>
        <Text selectable>{error}</Text>
      </View>
    );
  }
  if (!boot) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  return (
    <SafeAreaProvider>
      <ThemeProvider initialPalette={boot.palette} initialMode={boot.mode}>
        <LockProvider initial={boot.lock}>
          <Services>
            <ThemedStack />
          </Services>
        </LockProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
