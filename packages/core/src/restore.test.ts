import { describe, expect, it } from 'vitest';
import { sanitizeRestoredSource } from './restore';

const ok = { id: 'user_1', label: 'Nu', kind: 'bank', package_pattern: '^com\\.nu\\.production$', user_added: 1, enabled: 1, bound_package: 'com.evil.app' };

describe('sanitizeRestoredSource', () => {
  it('acepta un patrón exacto, lo desactiva y quita el vínculo', () => {
    expect(sanitizeRestoredSource(ok)).toEqual({
      id: 'user_1', label: 'Nu', kind: 'bank', package_pattern: '^com\\.nu\\.production$', enabled: 0, user_added: 1, bound_package: null,
    });
  });
  it('rechaza match-all y regex catastróficos', () => {
    for (const p of ['.*', '^.+$', '(a+)+$', '^com.*$', 'com\\.nu']) {
      expect(sanitizeRestoredSource({ ...ok, package_pattern: p })).toBeNull();
    }
  });
  it('rechaza fuentes que no son del usuario o con tipo inválido', () => {
    expect(sanitizeRestoredSource({ ...ok, user_added: 0 })).toBeNull();
    expect(sanitizeRestoredSource({ ...ok, kind: 'sms' })).toBeNull();
    expect(sanitizeRestoredSource(null)).toBeNull();
  });
});