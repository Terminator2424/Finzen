import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { buildSchedule } from './credit';
import { categorize } from './categorize';
import { decryptBackup, encryptBackup, isEncryptedBackup } from './backupCrypto';
import { processNotification } from './notifications/pipeline';

const rnd = (n: number) => new Uint8Array(randomBytes(n));
const FAST = 2 ** 12; // N mínimo permitido, para que el test sea rápido

describe('respaldo cifrado', () => {
  it('ida y vuelta', async () => {
    const env = await encryptBackup('{"saldo":123456}', 'una-clave-larga-1', rnd, FAST);
    expect(isEncryptedBackup(env)).toBe(true);
    expect(env).not.toContain('123456');
    expect(await decryptBackup(env, 'una-clave-larga-1')).toBe('{"saldo":123456}');
  });
  it('contraseña incorrecta falla', async () => {
    const env = await encryptBackup('secreto', 'una-clave-larga-1', rnd, FAST);
    await expect(decryptBackup(env, 'otra-clave-larga-2')).rejects.toThrow(/incorrecta/);
  });
  it('detecta alteraciones del contenido y de los parámetros', async () => {
    const env = JSON.parse(await encryptBackup('secreto', 'una-clave-larga-1', rnd, FAST));
    const flip = (hex: string) => (hex[0] === 'a' ? 'b' : 'a') + hex.slice(1);
    await expect(decryptBackup(JSON.stringify({ ...env, ct: flip(env.ct) }), 'una-clave-larga-1')).rejects.toThrow();
    await expect(decryptBackup(JSON.stringify({ ...env, salt: flip(env.salt) }), 'una-clave-larga-1')).rejects.toThrow();
  });
  it('rechaza N enorme (agotamiento de memoria) y N no permitido', async () => {
    const env = JSON.parse(await encryptBackup('x', 'una-clave-larga-1', rnd, FAST));
    await expect(decryptBackup(JSON.stringify({ ...env, N: 2 ** 30 }), 'una-clave-larga-1')).rejects.toThrow(/no permitidos/);
    await expect(decryptBackup(JSON.stringify({ ...env, N: 3000 }), 'una-clave-larga-1')).rejects.toThrow(/no permitidos/);
  });
  it('exige contraseña de al menos 10 caracteres', async () => {
    await expect(encryptBackup('x', 'corta', rnd, FAST)).rejects.toThrow(/al menos/);
  });
  it('cada cifrado usa sal y nonce distintos', async () => {
    const a = JSON.parse(await encryptBackup('x', 'una-clave-larga-1', rnd, FAST));
    const b = JSON.parse(await encryptBackup('x', 'una-clave-larga-1', rnd, FAST));
    expect(a.salt).not.toBe(b.salt);
    expect(a.ct).not.toBe(b.ct);
  });
});

describe('denegación de servicio por entradas', () => {
  it('buildSchedule rechaza un número absurdo de cuotas', () => {
    expect(() => buildSchedule({ principal: 1000, installments: 1_000_000_000, monthlyRate: 0.01, firstDueDate: '2026-11-01' })).toThrow();
  });
  it('una regla "regex" (p. ej. importada de un respaldo) nunca se ejecuta como regex', () => {
    const evil = { pattern: '(a+)+$', matchType: 'regex' as const, categoryId: 'cat_otros', priority: 9 };
    const t0 = Date.now();
    categorize('a'.repeat(40) + '!', [evil]);
    expect(Date.now() - t0).toBeLessThan(200);
  });
  it('una notificación gigantesca se procesa rápido y se trunca', () => {
    const big = 'Pagaste $5.000 en Tienda ' + '9 '.repeat(200_000);
    const t0 = Date.now();
    const r = processNotification({ packageName: 'com.nequi.MobileApp', text: big, receivedAt: 1 });
    expect(Date.now() - t0).toBeLessThan(500);
    expect(r.outcome === 'imported' && r.maskedText.length).toBeLessThanOrEqual(300);
  });
});

describe('evasión del filtro de OTP', () => {
  it('una clave escondida delante de mucho relleno igual se descarta', () => {
    const text = '482913 ' + 'x '.repeat(1500) + 'no lo compartas con nadie';
    const r = processNotification({ packageName: 'com.nequi.MobileApp', text, receivedAt: 1 });
    expect(r.outcome).toBe('discarded_otp');
  });
});

import { assertBackupSize, filterRestoredSettings, isPlainRow } from './restore';

describe('restauración de respaldos no confiables', () => {
  it('solo pasan ajustes de la lista cerrada y siempre como scope user', () => {
    const out = filterRestoredSettings([
      { key: 'palette', value: 'blue' },
      { key: 'ai_ollama_url', value: 'http://atacante.example' },  // ← redirigiría la IA
      { key: 'lock_enabled', value: '0' },                          // ← apagaría el bloqueo
      { key: 'ai_provider', value: 'ollama' },
      { key: 'mode', value: 'dark' },
      { key: 'mode', value: '<script>' },                           // valor inválido
    ]);
    expect(out.map((r) => r.key)).toEqual(['palette', 'mode']);
    expect(out.every((r) => r.scope === 'user')).toBe(true);
  });
  it('entradas que no son lista se ignoran', () => {
    expect(filterRestoredSettings('hola')).toEqual([]);
    expect(filterRestoredSettings(null)).toEqual([]);
  });
  it('filas anidadas o con tipos raros se rechazan', () => {
    expect(isPlainRow({ a: 1, b: 'x', c: null })).toBe(true);
    expect(isPlainRow({ a: { b: 1 } })).toBe(false);
    expect(isPlainRow([1, 2])).toBe(false);
    expect(isPlainRow(null)).toBe(false);
  });
  it('rechaza respaldos desmesurados', () => {
    expect(() => assertBackupSize('x'.repeat(31_000_000), {})).toThrow();
    expect(() => assertBackupSize('{}', { t: new Array(250_000).fill({}) })).toThrow();
  });
});
