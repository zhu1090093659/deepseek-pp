import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  ENC_PREFIX,
  encryptStoreForDisk,
  decryptStoreInPlace,
  isBrowserControlEnabled,
} = require('../desktop/store-crypto.cjs') as {
  ENC_PREFIX: string;
  encryptStoreForDisk: (store: Record<string, unknown>, keys: Set<string>, safeStorage: FakeSafeStorage) => Record<string, unknown>;
  decryptStoreInPlace: (store: Record<string, unknown>, keys: Set<string>, safeStorage: FakeSafeStorage) => Record<string, unknown>;
  isBrowserControlEnabled: (store: Record<string, unknown>, key: string) => boolean;
};

const BROWSER_CONTROL_KEY = 'deepseek_pp_browser_control_settings';
const SENSITIVE_KEYS = new Set(['deepseekCachedClientHeaders', BROWSER_CONTROL_KEY]);

// Reversible stand-in for Electron safeStorage (base64 round-trip).
interface FakeSafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(s: string): Buffer;
  decryptString(b: Buffer): string;
}
const fakeSafeStorage: FakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s, 'utf8'),
  decryptString: (b: Buffer) => b.toString('utf8'),
};

describe('store at-rest crypto + browser-control gate', () => {
  it('keeps browser control enabled across a persist→restart→load cycle (regression)', () => {
    // 1) Side panel enables browser control; main process holds plaintext.
    const live: Record<string, unknown> = { [BROWSER_CONTROL_KEY]: { enabled: true } };
    expect(isBrowserControlEnabled(live, BROWSER_CONTROL_KEY)).toBe(true);

    // 2) persist() encrypts sensitive keys to disk.
    const disk = encryptStoreForDisk(live, SENSITIVE_KEYS, fakeSafeStorage);
    expect(typeof disk[BROWSER_CONTROL_KEY]).toBe('string');
    expect(disk[BROWSER_CONTROL_KEY] as string).toMatch(new RegExp('^' + ENC_PREFIX));

    // 3) Restart: the store is reloaded from disk as the raw encrypted string.
    const reloaded: Record<string, unknown> = JSON.parse(JSON.stringify(disk));
    // Without decryption the gate sees a string → the bug the maintainer found.
    expect(isBrowserControlEnabled(reloaded, BROWSER_CONTROL_KEY)).toBe(false);

    // 4) Startup decrypts sensitive keys into memory.
    decryptStoreInPlace(reloaded, SENSITIVE_KEYS, fakeSafeStorage);
    expect(reloaded[BROWSER_CONTROL_KEY]).toEqual({ enabled: true });

    // 5) The gate now correctly reports enabled after restart.
    expect(isBrowserControlEnabled(reloaded, BROWSER_CONTROL_KEY)).toBe(true);
  });

  it('round-trips auth headers and leaves non-sensitive/plaintext values untouched', () => {
    const headers = { Authorization: 'Bearer abc123' };
    const live: Record<string, unknown> = {
      deepseekCachedClientHeaders: headers,
      someOtherKey: { plain: true },
    };
    const disk = encryptStoreForDisk(live, SENSITIVE_KEYS, fakeSafeStorage);
    expect(disk.someOtherKey).toEqual({ plain: true }); // non-sensitive untouched

    const reloaded: Record<string, unknown> = JSON.parse(JSON.stringify(disk));
    decryptStoreInPlace(reloaded, SENSITIVE_KEYS, fakeSafeStorage);
    expect(reloaded.deepseekCachedClientHeaders).toEqual(headers);
    expect(reloaded.someOtherKey).toEqual({ plain: true });
  });

  it('is a no-op when encryption is unavailable (values stay plaintext)', () => {
    const noEnc: FakeSafeStorage = { ...fakeSafeStorage, isEncryptionAvailable: () => false };
    const live: Record<string, unknown> = { [BROWSER_CONTROL_KEY]: { enabled: true } };
    const disk = encryptStoreForDisk(live, SENSITIVE_KEYS, noEnc);
    expect(disk[BROWSER_CONTROL_KEY]).toEqual({ enabled: true });
    decryptStoreInPlace(disk, SENSITIVE_KEYS, noEnc);
    expect(isBrowserControlEnabled(disk, BROWSER_CONTROL_KEY)).toBe(true);
  });
});
