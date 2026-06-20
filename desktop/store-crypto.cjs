'use strict';

// Pure helpers for the persisted store's at-rest encryption + the browser-control
// gate. Extracted from main.cjs so the restart/persisted-enabled path can be
// unit-tested without booting Electron (safeStorage is dependency-injected).
//
// Sensitive keys are stored on disk as `__enc__:<base64>` via Electron
// safeStorage. The in-memory `store` must hold the DECRYPTED value so every
// reader (the browser-control gate, header de-dup, dpp-store-get) sees plaintext;
// persist() re-encrypts on write. Reading an encrypted string directly is the
// regression this module guards against: `{ enabled: true }` persisted and then
// reloaded as a string would make the gate evaluate `s.enabled` on a string and
// silently disable browser control.

const ENC_PREFIX = '__enc__:';

// Encrypt sensitive keys for disk. Returns a shallow copy; `store` is untouched.
function encryptStoreForDisk(store, sensitiveKeys, safeStorage) {
  const diskStore = { ...store };
  for (const key of sensitiveKeys) {
    if (diskStore[key] != null && safeStorage.isEncryptionAvailable()) {
      try {
        const json = typeof diskStore[key] === 'string' ? diskStore[key] : JSON.stringify(diskStore[key]);
        diskStore[key] = ENC_PREFIX + safeStorage.encryptString(json).toString('base64');
      } catch (e) {
        console.warn('[dpp] encrypt failed for key', key, e && e.message);
      }
    }
  }
  return diskStore;
}

// Decrypt a single value if it is an encrypted sensitive key; otherwise return
// it unchanged (so already-plaintext / non-sensitive values pass through).
function decryptStoreValue(key, value, sensitiveKeys, safeStorage) {
  if (!sensitiveKeys.has(key) || typeof value !== 'string' || !value.startsWith(ENC_PREFIX)) return value;
  try {
    const buf = Buffer.from(value.slice(ENC_PREFIX.length), 'base64');
    return JSON.parse(safeStorage.decryptString(buf));
  } catch {
    return value;
  }
}

// Decrypt all sensitive keys in `store` in place (used once at startup so the
// in-memory store is plaintext for every reader).
function decryptStoreInPlace(store, sensitiveKeys, safeStorage) {
  for (const key of sensitiveKeys) {
    if (key in store) store[key] = decryptStoreValue(key, store[key], sensitiveKeys, safeStorage);
  }
  return store;
}

// The browser-control gate. Expects a DECRYPTED settings object.
function isBrowserControlEnabled(store, browserControlKey) {
  const s = store[browserControlKey];
  return !!(s && s.enabled === true);
}

module.exports = {
  ENC_PREFIX,
  encryptStoreForDisk,
  decryptStoreValue,
  decryptStoreInPlace,
  isBrowserControlEnabled,
};
