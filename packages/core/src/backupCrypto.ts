import { gcm } from '@noble/ciphers/aes.js';
import { bytesToHex, bytesToUtf8, hexToBytes, utf8ToBytes } from '@noble/ciphers/utils.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';

/**
 * Respaldos cifrados. Un respaldo en claro con todas tus finanzas, guardado en Drive o enviado
 * por correo, es una fuga esperando a pasar: por eso el JSON siempre se cifra con una contraseña.
 *
 *  - Clave: scrypt (N=2^15, r=8, p=1) → 256 bits. Resistente a fuerza bruta con GPU.
 *  - Cifrado: AES-256-GCM (confidencialidad + integridad: si alguien altera el archivo, falla).
 *  - Los parámetros viajan en el archivo y se autentican como "datos asociados" (AAD).
 *  - Librerías: @noble/ciphers y @noble/hashes (auditadas, sin dependencias, JS puro).
 *  - Al descifrar se limita N para que un archivo malicioso no pueda agotar la memoria.
 */
const DEFAULT_N = 2 ** 15;
const MAX_N = 2 ** 17; // tope al descifrar (≈128 MB)
export const MIN_PASSPHRASE = 10;

interface Envelope {
  app: 'finzen';
  enc: 1;
  kdf: 'scrypt';
  N: number;
  r: number;
  p: number;
  salt: string;
  nonce: string;
  ct: string;
}

const aad = (e: Pick<Envelope, 'N' | 'r' | 'p' | 'salt' | 'nonce'>) =>
  utf8ToBytes(`finzen|enc1|scrypt|${e.N}|${e.r}|${e.p}|${e.salt}|${e.nonce}`);

async function deriveKey(passphrase: string, salt: Uint8Array, N: number, r: number, p: number) {
  return scryptAsync(utf8ToBytes(passphrase.normalize('NFKC')), salt, { N, r, p, dkLen: 32, asyncTick: 10 });
}

export function isEncryptedBackup(text: string): boolean {
  try {
    const j = JSON.parse(text) as Partial<Envelope>;
    return j.app === 'finzen' && j.enc === 1 && typeof j.ct === 'string';
  } catch {
    return false;
  }
}

/** `rnd` debe ser un generador criptográficamente seguro (en la app: expo-crypto). */
export async function encryptBackup(
  plain: string, passphrase: string, rnd: (n: number) => Uint8Array, N = DEFAULT_N,
): Promise<string> {
  if (passphrase.length < MIN_PASSPHRASE) throw new Error(`La contraseña debe tener al menos ${MIN_PASSPHRASE} caracteres.`);
  const salt = rnd(16);
  const nonce = rnd(12);
  const base = { N, r: 8, p: 1, salt: bytesToHex(salt), nonce: bytesToHex(nonce) };
  const key = await deriveKey(passphrase, salt, N, 8, 1);
  const ct = gcm(key, nonce, aad(base)).encrypt(utf8ToBytes(plain));
  const env: Envelope = { app: 'finzen', enc: 1, kdf: 'scrypt', ...base, ct: bytesToHex(ct) };
  return JSON.stringify(env);
}

export async function decryptBackup(envelopeText: string, passphrase: string): Promise<string> {
  let e: Envelope;
  try { e = JSON.parse(envelopeText) as Envelope; } catch { throw new Error('El archivo no es un respaldo válido.'); }
  if (e.app !== 'finzen' || e.enc !== 1 || e.kdf !== 'scrypt') throw new Error('Formato de respaldo no reconocido.');
  const okParams = Number.isInteger(e.N) && e.N >= 2 ** 12 && e.N <= MAX_N && (e.N & (e.N - 1)) === 0 && e.r === 8 && e.p === 1;
  if (!okParams) throw new Error('Parámetros de cifrado no permitidos.');
  try {
    const key = await deriveKey(passphrase, hexToBytes(e.salt), e.N, e.r, e.p);
    return bytesToUtf8(gcm(key, hexToBytes(e.nonce), aad(e)).decrypt(hexToBytes(e.ct)));
  } catch {
    // No se distingue "contraseña mala" de "archivo alterado": ambos se rechazan igual.
    throw new Error('Contraseña incorrecta o el archivo fue alterado.');
  }
}
