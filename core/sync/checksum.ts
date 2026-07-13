export const SHA256_ALGORITHM = 'sha256' as const;

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

export interface Sha256Checksum {
  algorithm: typeof SHA256_ALGORITHM;
  value: string;
}

export async function createSha256Checksum(content: string): Promise<Sha256Checksum> {
  return createSha256ChecksumFromBytes(new TextEncoder().encode(content));
}

export async function createSha256ChecksumFromBytes(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<Sha256Checksum> {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) throw new Error('Web Crypto SHA-256 is required');
  const digest = await cryptoApi.subtle.digest('SHA-256', bytes);
  return {
    algorithm: SHA256_ALGORITHM,
    value: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''),
  };
}

export async function assertSha256Checksum(
  label: string,
  content: string,
  expected: Sha256Checksum,
): Promise<void> {
  const actual = await createSha256Checksum(content);
  if (actual.value !== expected.value) throw new Error(`${label} checksum does not match`);
}

export function parseSha256Checksum(value: unknown, label: string): Sha256Checksum {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const object = value as Record<string, unknown>;
  if (
    object.algorithm !== SHA256_ALGORITHM
    || typeof object.value !== 'string'
    || !SHA256_HEX_PATTERN.test(object.value)
  ) {
    throw new Error(`${label} is invalid`);
  }
  return { algorithm: SHA256_ALGORITHM, value: object.value };
}
