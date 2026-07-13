import { describe, expect, it } from 'vitest';
import {
  SYNC_CURRENT_POINTER_KEY,
  SYNC_GENERATION_FILE_KEYS,
  getSyncGenerationFileKey,
  getSyncGenerationManifestKey,
} from '../core/sync/contracts';
import {
  readCurrentSyncGeneration,
  uploadSyncGeneration,
  type SyncGenerationSourceFile,
} from '../core/sync/generation';
import { serializeSyncDataSnapshot, type SyncDataSnapshot } from '../core/sync/snapshot';
import type { StorageBackend } from '../core/sync/storage-backend';
import { SYNC_GENERATION_V1_FIXTURE } from './fixtures/persistence-contract/sync';

const GENERATION_ID = 'generation-test-1';
const CREATED_AT = 1_700_000_000_000;
const REMOTE_WRITE_COUNT = SYNC_GENERATION_FILE_KEYS.length + 2;

describe('sync generation publication', () => {
  it('creates a safe unique generation ID through the production entropy path', async () => {
    const backend = new MemoryStorageBackend();
    const manifest = await uploadSyncGeneration(backend, sourceFiles('default-id'));

    expect(manifest.generationId).toMatch(/^[a-z0-9]+-[a-f0-9]{32}$/);
    expect(backend.store.has(getSyncGenerationManifestKey(manifest.generationId))).toBe(true);
  });

  it('serializes exactly one payload for every logical sync file', () => {
    const snapshot: SyncDataSnapshot = {
      memories: [],
      skills: [],
      skillSources: [],
      presets: [],
      projectContext: { schemaVersion: 2, projects: [], conversations: [], pendingProjectId: null },
      savedItems: { schemaVersion: 1, items: [] },
    };

    expect(serializeSyncDataSnapshot(snapshot)).toEqual([
      { key: 'memories.json', content: '[]' },
      { key: 'skills.json', content: '[]' },
      { key: 'skill-sources.json', content: '[]' },
      { key: 'presets.json', content: '[]' },
      {
        key: 'project-context.json',
        content: '{"schemaVersion":2,"projects":[],"conversations":[],"pendingProjectId":null}',
      },
      { key: 'saved-items.json', content: '{"schemaVersion":1,"items":[]}' },
    ]);
    expect(() => serializeSyncDataSnapshot({ ...snapshot, projectContext: null }))
      .toThrow('Project context is required');
    expect(() => serializeSyncDataSnapshot({ ...snapshot, savedItems: null }))
      .toThrow('Saved items are required');
  });

  it('publishes complete data before the manifest and current pointer', async () => {
    const backend = new MemoryStorageBackend();
    const files = sourceFiles('新一代 🚀');
    const manifest = await upload(backend, files, GENERATION_ID);
    const dataKeys = SYNC_GENERATION_FILE_KEYS.map((key) => getSyncGenerationFileKey(GENERATION_ID, key));
    const manifestKey = getSyncGenerationManifestKey(GENERATION_ID);

    expect(backend.putCalls).toEqual([...dataKeys, manifestKey, SYNC_CURRENT_POINTER_KEY]);
    for (const key of dataKeys) {
      expect(backend.events.indexOf(`complete:${key}`))
        .toBeLessThan(backend.events.indexOf(`start:${manifestKey}`));
    }
    expect(backend.events.indexOf(`complete:${manifestKey}`))
      .toBeLessThan(backend.events.indexOf(`start:${SYNC_CURRENT_POINTER_KEY}`));
    expect(manifest.files.map((file) => file.key)).toEqual(SYNC_GENERATION_FILE_KEYS);
    expect(manifest.files.every((file) => file.checksum.algorithm === 'sha256')).toBe(true);
    expect(manifest.files.every((file) => /^[a-f0-9]{64}$/.test(file.checksum.value))).toBe(true);
    expect(manifest.files[0].byteLength).toBe(new TextEncoder().encode(files[0].content).byteLength);
    expect(Object.fromEntries(await readCurrentSyncGeneration(backend) ?? []))
      .toEqual(sourceFileRecord(files));
    expect(SYNC_GENERATION_FILE_KEYS.some((key) => backend.store.has(key))).toBe(false);
  });

  it.each(Array.from({ length: REMOTE_WRITE_COUNT }, (_, index) => index))(
    'keeps the previous generation authoritative when remote write %i fails',
    async (failureIndex) => {
      const backend = new MemoryStorageBackend();
      const previousFiles = sourceFiles('previous');
      await upload(backend, previousFiles, 'generation-previous');
      const previousPointer = backend.store.get(SYNC_CURRENT_POINTER_KEY);
      backend.resetTrace();
      backend.failBeforePutAt = failureIndex;

      await expect(upload(backend, sourceFiles('candidate'), 'generation-candidate')).rejects.toThrow();
      expect(backend.store.get(SYNC_CURRENT_POINTER_KEY)).toBe(previousPointer);
      expect(Object.fromEntries(await readCurrentSyncGeneration(backend) ?? []))
        .toEqual(sourceFileRecord(previousFiles));
      expect(SYNC_GENERATION_FILE_KEYS.some((key) => backend.store.has(key))).toBe(false);
    },
  );

  it.each(Array.from({ length: REMOTE_WRITE_COUNT - 1 }, (_, index) => index))(
    'keeps the previous generation authoritative when remote write %i commits but loses its response',
    async (failureIndex) => {
      const backend = new MemoryStorageBackend();
      const previousFiles = sourceFiles('previous');
      await upload(backend, previousFiles, 'generation-previous');
      const previousPointer = backend.store.get(SYNC_CURRENT_POINTER_KEY);
      backend.resetTrace();
      backend.commitThenFailAt = failureIndex;

      await expect(upload(backend, sourceFiles('candidate'), 'generation-candidate')).rejects.toThrow();
      expect(backend.store.get(SYNC_CURRENT_POINTER_KEY)).toBe(previousPointer);
      expect(Object.fromEntries(await readCurrentSyncGeneration(backend) ?? []))
        .toEqual(sourceFileRecord(previousFiles));
    },
  );

  it('settles every staged write before reporting a staged failure', async () => {
    const backend = new MemoryStorageBackend();
    backend.failBeforePutAt = 0;

    await expect(upload(backend, sourceFiles('candidate'), GENERATION_ID)).rejects.toThrow();
    expect(backend.putCalls).toHaveLength(SYNC_GENERATION_FILE_KEYS.length);
    expect(backend.events.filter((event) => event.startsWith('complete:'))).toHaveLength(
      SYNC_GENERATION_FILE_KEYS.length - 1,
    );
  });

  it('turns a synchronous backend throw into one settled staged failure', async () => {
    const putCalls: string[] = [];
    const backend: StorageBackend = {
      async test() {},
      async ensureStore() {},
      async get() { return null; },
      put(key) {
        putCalls.push(key);
        if (putCalls.length === 1) throw new Error('Injected synchronous failure');
        return Promise.resolve();
      },
    };

    await expect(uploadSyncGeneration(backend, sourceFiles('candidate'), {
      now: () => CREATED_AT,
      createGenerationId: () => GENERATION_ID,
    })).rejects.toThrow('memories.json: Injected synchronous failure');
    expect(putCalls).toHaveLength(SYNC_GENERATION_FILE_KEYS.length);
  });

  it('accepts a pointer write whose response was lost after commit', async () => {
    const backend = new MemoryStorageBackend();
    backend.commitThenFailAt = SYNC_GENERATION_FILE_KEYS.length + 1;

    await expect(upload(backend, sourceFiles('committed'), GENERATION_ID)).resolves.toBeDefined();
    expect(Object.fromEntries(await readCurrentSyncGeneration(backend) ?? []))
      .toEqual(sourceFileRecord(sourceFiles('committed')));
  });

  it('reports an indeterminate pointer commit when publish and read-back fail', async () => {
    const backend = new MemoryStorageBackend();
    backend.failBeforePutAt = SYNC_GENERATION_FILE_KEYS.length + 1;
    backend.failGets.add(SYNC_CURRENT_POINTER_KEY);

    await expect(upload(backend, sourceFiles('unknown'), GENERATION_ID))
      .rejects.toThrow('Sync generation pointer commit outcome is unknown');
  });

  it('allows concurrent publishers to expose only one complete generation', async () => {
    const backend = new MemoryStorageBackend();
    const first = sourceFiles('first');
    const second = sourceFiles('second');
    await Promise.all([
      upload(backend, first, 'generation-first'),
      upload(backend, second, 'generation-second'),
    ]);

    const downloaded = Object.fromEntries(await readCurrentSyncGeneration(backend) ?? []);
    expect([sourceFileRecord(first), sourceFileRecord(second)]).toContainEqual(downloaded);
  });
});

describe('sync generation reader', () => {
  it('reads the independent raw schema-v1 generation fixture', async () => {
    const backend = new MemoryStorageBackend();
    for (const file of SYNC_GENERATION_V1_FIXTURE.files) {
      backend.store.set(file.remoteKey, file.content);
    }
    backend.store.set(SYNC_GENERATION_V1_FIXTURE.manifestKey, SYNC_GENERATION_V1_FIXTURE.manifest);
    backend.store.set(SYNC_GENERATION_V1_FIXTURE.currentPointerKey, SYNC_GENERATION_V1_FIXTURE.pointer);

    expect(SYNC_GENERATION_V1_FIXTURE.currentPointerKey).toBe(SYNC_CURRENT_POINTER_KEY);
    expect(Object.fromEntries(await readCurrentSyncGeneration(backend) ?? [])).toEqual(
      Object.fromEntries(SYNC_GENERATION_V1_FIXTURE.files.map((file) => [file.logicalKey, file.content])),
    );
  });

  it('signals legacy reading only when the current pointer is absent', async () => {
    const backend = new MemoryStorageBackend();
    for (const key of SYNC_GENERATION_FILE_KEYS) backend.store.set(key, `legacy:${key}`);

    await expect(readCurrentSyncGeneration(backend)).resolves.toBeNull();
    expect(backend.getCalls).toEqual([SYNC_CURRENT_POINTER_KEY]);
  });

  it('does not fall back to legacy files for corrupt or future pointers', async () => {
    const corrupt = new MemoryStorageBackend();
    corrupt.store.set(SYNC_CURRENT_POINTER_KEY, '{bad json}');
    for (const key of SYNC_GENERATION_FILE_KEYS) corrupt.store.set(key, `legacy:${key}`);
    await expect(readCurrentSyncGeneration(corrupt)).rejects.toThrow('pointer is not valid JSON');
    expect(corrupt.getCalls).toEqual([SYNC_CURRENT_POINTER_KEY]);

    const future = await publishedBackend();
    const pointer = JSON.parse(requiredStored(future, SYNC_CURRENT_POINTER_KEY)) as Record<string, unknown>;
    pointer.schemaVersion = 2;
    future.store.set(SYNC_CURRENT_POINTER_KEY, JSON.stringify(pointer));
    future.resetTrace();
    await expect(readCurrentSyncGeneration(future)).rejects.toThrow('pointer schema is not supported');
    expect(future.getCalls).toEqual([SYNC_CURRENT_POINTER_KEY]);
  });

  it('rejects a manifest whose bytes do not match the pointer checksum', async () => {
    const backend = await publishedBackend();
    const manifestKey = getSyncGenerationManifestKey(GENERATION_ID);
    backend.store.set(manifestKey, `${requiredStored(backend, manifestKey)}\n`);

    await expect(readCurrentSyncGeneration(backend))
      .rejects.toThrow('Sync generation manifest checksum does not match');
  });

  it.each([
    ['a missing file', (manifest: ManifestFixture) => { manifest.files.pop(); }, 'must contain 6 files'],
    ['a duplicate file', (manifest: ManifestFixture) => { manifest.files[1].key = manifest.files[0].key; }, 'Duplicate sync file key'],
    ['an unknown file', (manifest: ManifestFixture) => { manifest.files[0].key = '../escape.json'; }, 'key is not supported'],
    ['a mismatched ID', (manifest: ManifestFixture) => { manifest.generationId = 'generation-other'; }, 'pointer and manifest IDs do not match'],
  ] as const)('rejects manifests with %s', async (_name, mutate, error) => {
    const backend = await publishedBackend();
    await mutatePublishedManifest(backend, mutate);
    await expect(readCurrentSyncGeneration(backend)).rejects.toThrow(error);
  });

  it('rejects missing, size-mismatched, and checksum-mismatched files', async () => {
    const missing = await publishedBackend();
    missing.store.delete(getSyncGenerationFileKey(GENERATION_ID, SYNC_GENERATION_FILE_KEYS[0]));
    await expect(readCurrentSyncGeneration(missing)).rejects.toThrow('file is missing');

    const wrongSize = await publishedBackend();
    const sizeKey = getSyncGenerationFileKey(GENERATION_ID, SYNC_GENERATION_FILE_KEYS[1]);
    wrongSize.store.set(sizeKey, requiredStored(wrongSize, sizeKey) + 'x');
    await expect(readCurrentSyncGeneration(wrongSize)).rejects.toThrow('file size does not match');

    const wrongHash = await publishedBackend();
    const hashKey = getSyncGenerationFileKey(GENERATION_ID, SYNC_GENERATION_FILE_KEYS[2]);
    const original = requiredStored(wrongHash, hashKey);
    wrongHash.store.set(hashKey, original.slice(0, -1) + 'x');
    await expect(readCurrentSyncGeneration(wrongHash)).rejects.toThrow('checksum does not match');
  });
});

class MemoryStorageBackend implements StorageBackend {
  readonly store = new Map<string, string>();
  readonly events: string[] = [];
  readonly putCalls: string[] = [];
  readonly getCalls: string[] = [];
  readonly failGets = new Set<string>();
  failBeforePutAt: number | null = null;
  commitThenFailAt: number | null = null;

  async test(): Promise<void> {}
  async ensureStore(): Promise<void> {}

  async get(key: string): Promise<string | null> {
    this.getCalls.push(key);
    if (this.failGets.has(key)) throw new Error(`Injected get failure: ${key}`);
    return this.store.get(key) ?? null;
  }

  async put(key: string, content: string): Promise<void> {
    const index = this.putCalls.length;
    this.putCalls.push(key);
    this.events.push(`start:${key}`);
    if (index === this.failBeforePutAt) throw new Error(`Injected put failure: ${key}`);
    this.store.set(key, content);
    this.events.push(`complete:${key}`);
    if (index === this.commitThenFailAt) throw new Error(`Injected lost response: ${key}`);
  }

  resetTrace(): void {
    this.events.length = 0;
    this.putCalls.length = 0;
    this.getCalls.length = 0;
    this.failBeforePutAt = null;
    this.commitThenFailAt = null;
    this.failGets.clear();
  }
}

type ManifestFixture = { generationId: string; files: Array<{ key: string }> };

function sourceFiles(label: string): SyncGenerationSourceFile[] {
  return SYNC_GENERATION_FILE_KEYS.map((key, index) => ({
    key,
    content: JSON.stringify({ label, index, key }),
  }));
}

function sourceFileRecord(files: readonly SyncGenerationSourceFile[]): Record<string, string> {
  return Object.fromEntries(files.map((file) => [file.key, file.content]));
}

function upload(
  backend: MemoryStorageBackend,
  files: readonly SyncGenerationSourceFile[],
  generationId: string,
): ReturnType<typeof uploadSyncGeneration> {
  return uploadSyncGeneration(backend, files, {
    now: () => CREATED_AT,
    createGenerationId: () => generationId,
  });
}

async function publishedBackend(): Promise<MemoryStorageBackend> {
  const backend = new MemoryStorageBackend();
  await upload(backend, sourceFiles('published'), GENERATION_ID);
  backend.resetTrace();
  return backend;
}

async function mutatePublishedManifest(
  backend: MemoryStorageBackend,
  mutate: (manifest: ManifestFixture) => void,
): Promise<void> {
  const manifestKey = getSyncGenerationManifestKey(GENERATION_ID);
  const manifest = JSON.parse(requiredStored(backend, manifestKey)) as ManifestFixture;
  mutate(manifest);
  const manifestContent = JSON.stringify(manifest);
  backend.store.set(manifestKey, manifestContent);
  const pointer = JSON.parse(requiredStored(backend, SYNC_CURRENT_POINTER_KEY)) as {
    manifestChecksum: { value: string };
  };
  pointer.manifestChecksum.value = await sha256(manifestContent);
  backend.store.set(SYNC_CURRENT_POINTER_KEY, JSON.stringify(pointer));
}

async function sha256(content: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function requiredStored(backend: MemoryStorageBackend, key: string): string {
  const value = backend.store.get(key);
  if (value === undefined) throw new Error(`Missing test object: ${key}`);
  return value;
}
