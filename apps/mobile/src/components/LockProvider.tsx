import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ScreenCapture from 'expo-screen-capture';
import {
  authenticateBiometric, biometricAvailable, loadLockPrefs, pinLength, saveLockPref, verifyPin, type LockPrefs,
} from '../services/security';
import { useTheme } from '../theme/ThemeProvider';
import { AppText } from './ui';

/**
 * Bloqueo de la app. Se bloquea:
 *  - al abrir la app,
 *  - al volver de segundo plano si pasaron más minutos de los configurados,
 *  - tras N minutos sin tocar la pantalla (por defecto 5).
 * La pantalla de bloqueo es un overlay opaco: la navegación queda montada debajo.
 */
interface LockContextValue {
  prefs: LockPrefs;
  updatePrefs: (patch: Partial<LockPrefs>) => Promise<void>;
  lockNow: () => void;
}
const LockContext = createContext<LockContextValue | null>(null);
export const useLock = () => {
  const c = useContext(LockContext);
  if (!c) throw new Error('useLock fuera de <LockProvider>');
  return c;
};

export function LockProvider({ initial, children }: { initial: LockPrefs; children: React.ReactNode }) {
  const [prefs, setPrefs] = useState(initial);
  const [locked, setLocked] = useState(initial.enabled);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backgroundedAt = useRef<number | null>(null);

  const armIdle = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (prefs.enabled) idleTimer.current = setTimeout(() => setLocked(true), prefs.minutes * 60_000);
  }, [prefs.enabled, prefs.minutes]);

  useEffect(() => {
    armIdle();
    return () => { if (idleTimer.current) clearTimeout(idleTimer.current); };
  }, [armIdle]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background' || s === 'inactive') {
        backgroundedAt.current ??= Date.now();
      } else if (s === 'active') {
        const t = backgroundedAt.current;
        backgroundedAt.current = null;
        if (prefs.enabled && t !== null && Date.now() - t >= prefs.minutes * 60_000) setLocked(true);
      }
    });
    return () => sub.remove();
  }, [prefs.enabled, prefs.minutes]);

  // Bloqueo de capturas de pantalla (Blindado contra errores nativos)
  useEffect(() => {
    const toggleScreenCapture = async () => {
      try {
        if (prefs.secureScreen) {
          await ScreenCapture.preventScreenCaptureAsync();
        } else {
          await ScreenCapture.allowScreenCaptureAsync();
        }
      } catch (error) {
        console.warn("Aviso: No se pudo modificar el bloqueo de pantalla.", error);
      }
    };
    toggleScreenCapture();
  }, [prefs.secureScreen]);

  const updatePrefs = useCallback(async (patch: Partial<LockPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    if (patch.enabled !== undefined) await saveLockPref('lock_enabled', patch.enabled ? '1' : '0');
    if (patch.biometric !== undefined) await saveLockPref('lock_biometric', patch.biometric ? '1' : '0');
    if (patch.minutes !== undefined) await saveLockPref('lock_minutes', String(patch.minutes));
    if (patch.secureScreen !== undefined) await saveLockPref('secure_screen', patch.secureScreen ? '1' : '0');
  }, [prefs]);

  return (
    <LockContext.Provider value={{ prefs, updatePrefs, lockNow: () => prefs.enabled && setLocked(true) }}>
      {/* onStartShouldSetResponderCapture reinicia el temporizador de inactividad sin interferir con los toques */}
      <View style={{ flex: 1 }} onStartShouldSetResponderCapture={() => { armIdle(); return false; }}>
        {children}
        {locked && prefs.enabled && <LockScreen biometric={prefs.biometric} onUnlock={() => { setLocked(false); armIdle(); }} />}
      </View>
    </LockContext.Provider>
  );
}

function LockScreen({ biometric, onUnlock }: { biometric: boolean; onUnlock: () => void }) {
  const { colors } = useTheme();
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState('');
  const busy = useRef(false);
  const [len, setLen] = useState(6);
  useEffect(() => { pinLength().then(setLen); }, []);

  const tryBiometric = useCallback(async () => {
    if (!biometric || !(await biometricAvailable())) return;
    if (await authenticateBiometric()) onUnlock();
  }, [biometric, onUnlock]);

  useEffect(() => { tryBiometric(); }, [tryBiometric]);

  const press = async (d: string) => {
    if (busy.current) return;
    const next = (pin + d).slice(0, len);
    setPin(next);
    // Se verifica UNA sola vez, al completar el PIN: los dígitos parciales no cuentan como intento fallido.
    if (next.length < len) return;
    busy.current = true;
    const r = await verifyPin(next);
    busy.current = false;
    if (r.ok) { onUnlock(); return; }
    setPin('');
    setMsg(r.lockedForMs > 0 ? `Demasiados intentos. Espera ${Math.ceil(r.lockedForMs / 1000)} s.` : `PIN incorrecto. Intentos restantes: ${r.attemptsLeft}`);
  };

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', gap: 18, zIndex: 100 }]}>
      <Ionicons name="lock-closed" size={44} color={colors.primary} />
      <AppText variant="title">FinZen bloqueado</AppText>
      <View style={{ flexDirection: 'row', gap: 10, height: 18 }}>
        {Array.from({ length: len }).map((_, i) => (
          <View key={i} style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: i < pin.length ? colors.primary : colors.border }} />
        ))}
      </View>
      <AppText variant="caption" color={colors.danger}>{msg}</AppText>
      <View style={{ width: 270, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <Key key={d} label={d} onPress={() => press(d)} />)}
        <Key label={biometric ? '☝' : ''} onPress={tryBiometric} />
        <Key label="0" onPress={() => press('0')} />
        <Key label="⌫" onPress={() => { setPin((p) => p.slice(0, -1)); setMsg(''); }} />
      </View>
    </View>
  );
}

function Key({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!label}
      style={({ pressed }) => ({ width: 78, height: 62, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: label ? (pressed ? colors.border : colors.surface) : 'transparent' })}>
      <Text style={{ fontSize: 24, color: colors.text }}>{label}</Text>
    </Pressable>
  );
}

export { loadLockPrefs };