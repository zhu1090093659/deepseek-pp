const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const SALT = 'deepseek-pp-sync-v1';
const VERSION_PREFIX = 'v1:';

let cachedKey: CryptoKey | null = null;

async function getEncryptionKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(chrome.runtime.id),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  cachedKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(SALT),
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  );

  return cachedKey;
}

export async function encryptString(plaintext: string): Promise<string> {
  if (!plaintext) return plaintext;

  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    encoded,
  );

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return VERSION_PREFIX + btoa(String.fromCharCode(...combined));
}

export async function decryptString(value: string): Promise<string> {
  if (!value) return value;

  if (!value.startsWith(VERSION_PREFIX)) {
    throw new Error('Legacy plaintext detected. Please re-save to encrypt.');
  }

  const raw = value.slice(VERSION_PREFIX.length);
  const key = await getEncryptionKey();
  const combined = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));

  if (combined.length < IV_LENGTH + 1) {
    throw new Error('Corrupted ciphertext: too short.');
  }

  const iv = combined.slice(0, IV_LENGTH);
  const data = combined.slice(IV_LENGTH);

  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    data,
  );

  return new TextDecoder().decode(decrypted);
}
