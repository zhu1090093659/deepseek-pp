import {
  SYNC_CURRENT_POINTER_KEY,
  SYNC_GENERATION_FILE_KEYS,
  SYNC_GENERATION_KIND,
  SYNC_GENERATION_POINTER_KIND,
  SYNC_GENERATION_SCHEMA_VERSION,
  getSyncGenerationFileKey,
  getSyncGenerationManifestKey,
  isSyncFileKey,
  type SyncFileKey,
} from './contracts';
import type { StorageBackend } from './storage-backend';

const SHA256_ALGORITHM = 'sha256' as const;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const GENERATION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/i;

export interface SyncGenerationSourceFile {
  key: SyncFileKey;
  content: string;
}

export interface SyncChecksum {
  algorithm: typeof SHA256_ALGORITHM;
  value: string;
}

export interface SyncGenerationFileRecord {
  key: SyncFileKey;
  byteLength: number;
  checksum: SyncChecksum;
}

export interface SyncGenerationManifest {
  kind: typeof SYNC_GENERATION_KIND;
  schemaVersion: typeof SYNC_GENERATION_SCHEMA_VERSION;
  generationId: string;
  createdAt: number;
  files: SyncGenerationFileRecord[];
}

export interface SyncGenerationPointer {
  kind: typeof SYNC_GENERATION_POINTER_KIND;
  schemaVersion: typeof SYNC_GENERATION_SCHEMA_VERSION;
  generationId: string;
  publishedAt: number;
  manifestChecksum: SyncChecksum;
}

export interface SyncGenerationUploadOptions {
  now?: () => number;
  createGenerationId?: (createdAt: number) => string;
}

export async function uploadSyncGeneration(
  backend: StorageBackend,
  sourceFiles: readonly SyncGenerationSourceFile[],
  options: SyncGenerationUploadOptions = {},
): Promise<SyncGenerationManifest> {
  validateSourceFiles(sourceFiles);
  const createdAt = options.now?.() ?? Date.now();
  validateTimestamp(createdAt, 'generation createdAt');
  const generationId = options.createGenerationId?.(createdAt) ?? createGenerationId(createdAt);
  validateGenerationId(generationId);

  const files = await Promise.all(sourceFiles.map(createFileRecord));
  const manifest: SyncGenerationManifest = {
    kind: SYNC_GENERATION_KIND,
    schemaVersion: SYNC_GENERATION_SCHEMA_VERSION,
    generationId,
    createdAt,
    files,
  };
  const manifestContent = JSON.stringify(manifest);
  const manifestChecksum = await createChecksum(manifestContent);
  const pointer: SyncGenerationPointer = {
    kind: SYNC_GENERATION_POINTER_KIND,
    schemaVersion: SYNC_GENERATION_SCHEMA_VERSION,
    generationId,
    publishedAt: createdAt,
    manifestChecksum,
  };
  const pointerContent = JSON.stringify(pointer);

  const stagedWrites = await Promise.allSettled(sourceFiles.map(async (sourceFile) => {
    await backend.put(
      getSyncGenerationFileKey(generationId, sourceFile.key),
      sourceFile.content,
    );
  }));
  const stagedFailures = stagedWrites.flatMap((result, index) => result.status === 'rejected'
    ? [{ key: sourceFiles[index].key, reason: result.reason }]
    : []);
  if (stagedFailures.length > 0) {
    const detail = stagedFailures
      .map(({ key, reason }) => `${key}: ${errorMessage(reason)}`)
      .join('; ');
    throw new AggregateError(
      stagedFailures.map(({ reason }) => reason),
      detail,
    );
  }

  await backend.put(getSyncGenerationManifestKey(generationId), manifestContent);
  await publishPointer(backend, pointerContent);
  return manifest;
}

export async function readCurrentSyncGeneration(
  backend: StorageBackend,
): Promise<ReadonlyMap<SyncFileKey, string> | null> {
  const pointerContent = await backend.get(SYNC_CURRENT_POINTER_KEY);
  if (pointerContent === null) return null;

  const pointer = parsePointer(pointerContent);
  const manifestKey = getSyncGenerationManifestKey(pointer.generationId);
  const manifestContent = await backend.get(manifestKey);
  if (manifestContent === null) {
    throw new Error(`Sync generation manifest is missing: ${manifestKey}`);
  }
  await assertChecksum('Sync generation manifest', manifestContent, pointer.manifestChecksum);

  const manifest = parseManifest(manifestContent);
  if (manifest.generationId !== pointer.generationId) {
    throw new Error('Sync generation pointer and manifest IDs do not match');
  }

  const contents = await Promise.all(manifest.files.map(async (file) => {
    const remoteKey = getSyncGenerationFileKey(manifest.generationId, file.key);
    const content = await backend.get(remoteKey);
    if (content === null) throw new Error(`Sync generation file is missing: ${file.key}`);
    const byteLength = new TextEncoder().encode(content).byteLength;
    if (byteLength !== file.byteLength) {
      throw new Error(`Sync generation file size does not match: ${file.key}`);
    }
    await assertChecksum(`Sync generation file ${file.key}`, content, file.checksum);
    return [file.key, content] as const;
  }));

  return new Map(contents);
}

async function createFileRecord(sourceFile: SyncGenerationSourceFile): Promise<SyncGenerationFileRecord> {
  const bytes = new TextEncoder().encode(sourceFile.content);
  return {
    key: sourceFile.key,
    byteLength: bytes.byteLength,
    checksum: await createChecksumFromBytes(bytes),
  };
}

async function createChecksum(content: string): Promise<SyncChecksum> {
  return createChecksumFromBytes(new TextEncoder().encode(content));
}

async function createChecksumFromBytes(bytes: Uint8Array<ArrayBuffer>): Promise<SyncChecksum> {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) throw new Error('Web Crypto SHA-256 is required for sync generations');
  const digest = await cryptoApi.subtle.digest('SHA-256', bytes);
  return {
    algorithm: SHA256_ALGORITHM,
    value: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''),
  };
}

async function assertChecksum(label: string, content: string, expected: SyncChecksum): Promise<void> {
  const actual = await createChecksum(content);
  if (actual.value !== expected.value) throw new Error(`${label} checksum does not match`);
}

async function publishPointer(backend: StorageBackend, pointerContent: string): Promise<void> {
  try {
    await backend.put(SYNC_CURRENT_POINTER_KEY, pointerContent);
  } catch (publishError) {
    let observedPointer: string | null;
    try {
      observedPointer = await backend.get(SYNC_CURRENT_POINTER_KEY);
    } catch (verificationError) {
      throw new AggregateError(
        [publishError, verificationError],
        'Sync generation pointer commit outcome is unknown',
      );
    }
    if (observedPointer === pointerContent) return;
    throw publishError;
  }
}

function createGenerationId(createdAt: number): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.getRandomValues !== 'function') {
    throw new Error('Web Crypto random values are required for sync generations');
  }
  const entropy = cryptoApi.getRandomValues(new Uint8Array(16));
  const suffix = Array.from(entropy, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${createdAt.toString(36)}-${suffix}`;
}

function validateSourceFiles(sourceFiles: readonly SyncGenerationSourceFile[]): void {
  if (sourceFiles.length !== SYNC_GENERATION_FILE_KEYS.length) {
    throw new Error(`Sync generation must contain ${SYNC_GENERATION_FILE_KEYS.length} files`);
  }
  const keys = new Set<SyncFileKey>();
  sourceFiles.forEach((file, index) => {
    if (!isSyncFileKey(file.key)) throw new Error(`Unsupported sync file key: ${String(file.key)}`);
    if (keys.has(file.key)) throw new Error(`Duplicate sync file key: ${file.key}`);
    if (file.key !== SYNC_GENERATION_FILE_KEYS[index]) {
      throw new Error(`Sync generation file order is invalid at index ${index}`);
    }
    if (typeof file.content !== 'string') throw new Error(`Sync file content must be a string: ${file.key}`);
    keys.add(file.key);
  });
  for (const requiredKey of SYNC_GENERATION_FILE_KEYS) {
    if (!keys.has(requiredKey)) throw new Error(`Sync generation file is missing: ${requiredKey}`);
  }
}

function parsePointer(content: string): SyncGenerationPointer {
  const object = parseObject(content, 'Sync generation pointer');
  if (object.kind !== SYNC_GENERATION_POINTER_KIND) {
    throw new Error('Sync generation pointer kind is not supported');
  }
  if (object.schemaVersion !== SYNC_GENERATION_SCHEMA_VERSION) {
    throw new Error('Sync generation pointer schema is not supported');
  }
  const generationId = requiredString(object.generationId, 'Sync generation pointer generationId');
  validateGenerationId(generationId);
  return {
    kind: SYNC_GENERATION_POINTER_KIND,
    schemaVersion: SYNC_GENERATION_SCHEMA_VERSION,
    generationId,
    publishedAt: validateTimestamp(object.publishedAt, 'Sync generation pointer publishedAt'),
    manifestChecksum: parseChecksum(object.manifestChecksum, 'Sync generation pointer manifestChecksum'),
  };
}

function parseManifest(content: string): SyncGenerationManifest {
  const object = parseObject(content, 'Sync generation manifest');
  if (object.kind !== SYNC_GENERATION_KIND) {
    throw new Error('Sync generation manifest kind is not supported');
  }
  if (object.schemaVersion !== SYNC_GENERATION_SCHEMA_VERSION) {
    throw new Error('Sync generation manifest schema is not supported');
  }
  const generationId = requiredString(object.generationId, 'Sync generation manifest generationId');
  validateGenerationId(generationId);
  if (!Array.isArray(object.files)) throw new Error('Sync generation manifest files must be an array');
  const files = object.files.map((value, index) => parseFileRecord(value, index));
  validateSourceFiles(files.map((file) => ({ key: file.key, content: '' })));
  return {
    kind: SYNC_GENERATION_KIND,
    schemaVersion: SYNC_GENERATION_SCHEMA_VERSION,
    generationId,
    createdAt: validateTimestamp(object.createdAt, 'Sync generation manifest createdAt'),
    files,
  };
}

function parseFileRecord(value: unknown, index: number): SyncGenerationFileRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Sync generation manifest files[${index}] must be an object`);
  }
  const object = value as Record<string, unknown>;
  if (!isSyncFileKey(object.key)) {
    throw new Error(`Sync generation manifest files[${index}].key is not supported`);
  }
  const byteLength = object.byteLength;
  if (!Number.isSafeInteger(byteLength) || (byteLength as number) < 0) {
    throw new Error(`Sync generation manifest files[${index}].byteLength is invalid`);
  }
  return {
    key: object.key,
    byteLength: byteLength as number,
    checksum: parseChecksum(object.checksum, `Sync generation manifest files[${index}].checksum`),
  };
}

function parseChecksum(value: unknown, label: string): SyncChecksum {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const object = value as Record<string, unknown>;
  if (object.algorithm !== SHA256_ALGORITHM || typeof object.value !== 'string' || !SHA256_HEX_PATTERN.test(object.value)) {
    throw new Error(`${label} is invalid`);
  }
  return { algorithm: SHA256_ALGORITHM, value: object.value };
}

function parseObject(content: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is required`);
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateGenerationId(generationId: string): void {
  if (!GENERATION_ID_PATTERN.test(generationId)) throw new Error('Sync generation ID is invalid');
}

function validateTimestamp(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} is invalid`);
  return value as number;
}
