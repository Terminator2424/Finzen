import * as Crypto from 'expo-crypto';
import * as LocalAuth from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { getSetting, setSetting } from './repo';

/**
 * Bloqueo de la app: huella/rostro con PIN de respaldo.
 *  - El PIN nunca se guarda: se guarda un hash salado (SHA-256 repetido) en SecureStore,
 *    que en Android usa el Keystore del hardware.
 *  - Tras 5 intentos fallidos se bloquea el PIN un tiempo creciente.
 *  - Los ajustes (activado, biometría, minutos) son de ESTE dispositivo y no se sincronizan.
 */
const PIN_HASH = 'finzen_pin_hash';
const PIN_SALT = 'finzen_pin_salt';
const PIN_LEN = 'finzen_pin_len';
const FAILS = 'finzen_pin_fails';
const LOCK_UNTIL = 'finzen_pin_lock_until';
const ROUNDS = 300;

async function hashPin(pin: string, salt: string): Promise<string> {
  let h = salt + ':' + pin;
  for (let i = 0; i < ROUNDS; i++) h = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, h + salt);
  return h;
}

export const hasPin = async () => (await SecureStore.getItemAsync(PIN_HASH)) !== null;

export async function setPin(pin: string): Promise<void> {
  const salt = Crypto.randomUUID();
  await SecureStore.setItemAsync(PIN_SALT, salt);
  await SecureStore.setItemAsync(PIN_HASH, await hashPin(pin, salt));
  await SecureStore.setItemAsync(PIN_LEN, String(pin.length)); // la pantalla de bloqueo verifica solo al completar el PIN
  await SecureStore.setItemAsync(FAILS, '0');
}

export async function clearPin(): Promise<void> {
  for (const k of [PIN_HASH, PIN_SALT, PIN_LEN, FAILS, LOCK_UNTIL]) await SecureStore.deleteItemAsync(k);
}

export async function pinLength(): Promise<number> {
  const n = Number(await SecureStore.getItemAsync(PIN_LEN));
  return n >= 4 && n <= 6 ? n : 6;
}

export type PinResult = { ok: true } | { ok: false; lockedForMs: number; attemptsLeft: number };

export async function verifyPin(pin: string): Promise<PinResult> {
  const until = Number((await SecureStore.getItemAsync(LOCK_UNTIL)) ?? 0);
  if (until > Date.now()) return { ok: false, lockedForMs: until - Date.now(), attemptsLeft: 0 };

  const salt = await SecureStore.getItemAsync(PIN_SALT);
  const stored = await SecureStore.getItemAsync(PIN_HASH);
  if (salt && stored && (await hashPin(pin, salt)) === stored) {
    await SecureStore.setItemAsync(FAILS, '0');
    return { ok: true };
  }
  const fails = Number((await SecureStore.getItemAsync(FAILS)) ?? 0) + 1;
  await SecureStore.setItemAsync(FAILS, String(fails));
  if (fails >= 5) {
    const wait = Math.min(30 * 60_000, 30_000 * 2 ** (fails - 5)); // 30 s, 1 min, 2 min… tope 30 min
    await SecureStore.setItemAsync(LOCK_UNTIL, String(Date.now() + wait));
    return { ok: false, lockedForMs: wait, attemptsLeft: 0 };
  }
  return { ok: false, lockedForMs: 0, attemptsLeft: 5 - fails };
}

export async function biometricAvailable(): Promise<boolean> {
  try {
    return (await LocalAuth.hasHardwareAsync()) && (await LocalAuth.isEnrolledAsync());
  } catch { return false; }
}

export async function authenticateBiometric(): Promise<boolean> {
  try {
    const r = await LocalAuth.authenticateAsync({
      promptMessage: 'Desbloquear FinZen', cancelLabel: 'Usar PIN', disableDeviceFallback: true,
    });
    return r.success;
  } catch { return false; }
}

// ───────────── Preferencias de bloqueo (solo este dispositivo) ─────────────
export interface LockPrefs { enabled: boolean; biometric: boolean; minutes: number; secureScreen: boolean }

export async function loadLockPrefs(): Promise<LockPrefs> {
  const [e, b, m, s] = await Promise.all(['lock_enabled', 'lock_biometric', 'lock_minutes', 'secure_screen'].map(getSetting));
  return { enabled: e === '1', biometric: b !== '0', minutes: Number(m) || 5, secureScreen: s !== '0' }; // por defecto ACTIVADO: protege la pantalla de capturas y de la vista de apps recientes
}

export async function saveLockPref(key: 'lock_enabled' | 'lock_biometric' | 'lock_minutes' | 'secure_screen', value: string) {
  await setSetting(key, value, 'device');
}
