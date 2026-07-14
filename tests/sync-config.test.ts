import { describe, expect, it } from 'vitest';
import type { SyncConfig } from '../core/types';
import {
  SYNC_CONFIG_SCHEMA_VERSION,
  SyncConfigCommitIndeterminateError,
  SyncConfigConflictError,
  createSyncCommandTarget,
  createSyncConfigStore,
  decodeStoredSyncConfig,
  decodeSyncCommandTarget,
  replaceSyncConfigProvider,
  type SyncConfigStoragePort,
  type VersionedSyncConfig,
} from '../core/sync/config';

const LEGACY_WEBDAV = {
  url: 'https://dav.example.test/root',
  username: 'user',
  password: 'secret',
  remotePath: 'DeepSeekPP',
  lastSyncAt: null,
  futureCompatible: { retained: true },
} as const;

describe('sync configuration codec and store', () => {
  it('projects provider-less WebDAV to revision 0 without eager writes', async () => {
    const storage = new MemorySyncConfigStorage(LEGACY_WEBDAV);
    const store = createSyncConfigStore(storage);

    const record = await store.read();

    expect(record).toEqual({
      revision: 0,
      config: {
        ...LEGACY_WEBDAV,
        provider: 'webdav',
        schemaVersion: SYNC_CONFIG_SCHEMA_VERSION,
        revision: 0,
      },
    });
    expect(storage.writes).toBe(0);
    expect(storage.value).toEqual(LEGACY_WEBDAV);
  });

  it.each([
    {
      provider: 'webdav',
      url: '',
      username: '',
      password: '',
      remotePath: 'DeepSeekPP',
      lastSyncAt: null,
    },
    {
      provider: 'gdrive',
      clientId: '',
      clientSecret: '',
      lastSyncAt: null,
    },
    {
      provider: 'onedrive',
      clientId: 'client',
      clientSecret: 'secret',
      refreshToken: 'refresh',
      lastSyncAt: 17,
    },
  ] as const)('accepts the released unversioned $provider record', (value) => {
    const record = decodeStoredSyncConfig(value);
    expect(record.revision).toBe(0);
    expect(record.config).toMatchObject({ ...value, schemaVersion: 1, revision: 0 });
  });

  it('migrates on explicit save, increments one in-key revision, and rejects stale writers', async () => {
    const storage = new MemorySyncConfigStorage(LEGACY_WEBDAV);
    const store = createSyncConfigStore(storage, {
      conflictMessage: () => '配置已变化',
    });
    const loaded = (await store.read())!;
    const loadedConfig = requireWebdav(loaded.config);
    const first = await store.replace(createSyncCommandTarget({
      ...loadedConfig,
      remotePath: 'First',
    }, loaded.revision));

    expect(first.revision).toBe(1);
    expect(storage.value).toMatchObject({
      provider: 'webdav',
      remotePath: 'First',
      schemaVersion: 1,
      revision: 1,
      futureCompatible: { retained: true },
    });

    await expect(store.replace(createSyncCommandTarget({
      ...loadedConfig,
      remotePath: 'Stale',
    }, loaded.revision))).rejects.toMatchObject({
      name: 'SyncConfigConflictError',
      code: 'sync_config_conflict',
      message: '配置已变化',
      expectedRevision: 0,
      currentRevision: 1,
    });
    expect(requireWebdav(storage.value as VersionedSyncConfig).remotePath).toBe('First');

    const second = await store.replace(createSyncCommandTarget({
      ...requireWebdav(first.config),
      remotePath: 'Second',
    }, first.revision));
    expect(second.revision).toBe(2);
    expect(requireWebdav(storage.value as VersionedSyncConfig).remotePath).toBe('Second');
  });

  it('distinguishes a missing key from an existing legacy revision 0', async () => {
    const storage = new MemorySyncConfigStorage();
    const store = createSyncConfigStore(storage);
    expect(await store.read()).toBeNull();

    const created = await store.replace(createSyncCommandTarget(webdav('Created'), null));
    expect(created.revision).toBe(1);
    await expect(store.replace(createSyncCommandTarget(webdav('Wrong baseline'), null)))
      .rejects.toBeInstanceOf(SyncConfigConflictError);
  });

  it.each([
    [{ ...LEGACY_WEBDAV, schemaVersion: 99, revision: 1 }, 'schema is not supported'],
    [{ ...LEGACY_WEBDAV, provider: 'future-provider' }, 'provider is not supported'],
    [{ ...LEGACY_WEBDAV, lastSyncAt: -1 }, 'lastSyncAt'],
    [{ ...LEGACY_WEBDAV, revision: 2 }, 'Versionless'],
    [{ provider: 'webdav', url: 'https://dav', username: 'u', password: 'p', lastSyncAt: null }, 'remotePath'],
  ] as const)('rejects corrupt/future storage without rewriting it', async (value, message) => {
    const storage = new MemorySyncConfigStorage(value);
    const store = createSyncConfigStore(storage);
    await expect(store.read()).rejects.toThrow(message);
    expect(storage.value).toEqual(value);
    expect(storage.writes).toBe(0);
  });

  it('rejects undefined object fields instead of silently deleting them', async () => {
    const corrupt = { ...LEGACY_WEBDAV, additive: undefined };
    const storage = new MemorySyncConfigStorage(corrupt);
    const store = createSyncConfigStore(storage);

    await expect(store.read()).rejects.toThrow('JSON-compatible');
    expect(storage.value).toEqual(corrupt);
    expect(storage.writes).toBe(0);
    expect(() => decodeSyncCommandTarget({
      config: { ...webdav('Undefined target'), additive: undefined },
      expectedRevision: null,
    })).toThrow('JSON-compatible');
  });

  it('verifies a lost write response and rejects an unverifiable outcome', async () => {
    const committed = new MemorySyncConfigStorage();
    committed.commitThenFailWrites.add(1);
    const committedStore = createSyncConfigStore(committed);
    await expect(committedStore.replace(createSyncCommandTarget(webdav('Committed'), null)))
      .resolves.toMatchObject({ revision: 1 });

    const unknown = new MemorySyncConfigStorage();
    unknown.failBeforeWrites.add(1);
    unknown.failReads.add(2);
    const unknownStore = createSyncConfigStore(unknown);
    const error = await unknownStore.replace(createSyncCommandTarget(webdav('Unknown'), null))
      .catch((failure) => failure);
    expect(error).toBeInstanceOf(SyncConfigCommitIndeterminateError);
    expect(error).toMatchObject({
      code: 'sync_config_commit_indeterminate',
      message: 'Sync configuration commit outcome is unknown',
    });
    expect(unknown.present).toBe(false);
  });

  it('deep-clones and freezes a runtime target before it enters the operation queue', () => {
    const source = {
      config: {
        ...webdav('Immutable'),
        additive: { nested: ['original'] },
      },
      expectedRevision: null,
    };
    const target = decodeSyncCommandTarget(source);

    source.config.remotePath = 'Mutated';
    source.config.additive.nested[0] = 'mutated';

    const targetConfig = requireWebdav(target.config) as Extract<SyncConfig, { provider: 'webdav' }>
      & { additive: { nested: string[] } };
    expect(targetConfig.remotePath).toBe('Immutable');
    expect(targetConfig.additive.nested)
      .toEqual(['original']);
    expect(Object.isFrozen(target.config)).toBe(true);
    expect(Object.isFrozen(targetConfig.additive)).toBe(true);
    expect(() => decodeSyncCommandTarget({ config: webdav('Missing revision') }))
      .toThrow('expectedRevision is required');
    expect(() => decodeSyncCommandTarget({
      config: { ...webdav('Mismatch'), schemaVersion: 1, revision: 2 },
      expectedRevision: 1,
    })).toThrow('does not match expectedRevision');
  });

  it('preserves additive __proto__ data without mutating the clone prototype', () => {
    const source = JSON.parse(JSON.stringify({
      config: webdav('Prototype-safe'),
      expectedRevision: null,
    })) as { config: Record<string, unknown>; expectedRevision: null };
    Object.defineProperty(source.config, '__proto__', {
      value: { polluted: true },
      enumerable: true,
    });

    const target = decodeSyncCommandTarget(source);

    expect(Object.getPrototypeOf(target.config)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(target.config, '__proto__')).toBe(true);
    expect((target.config as SyncConfig & { __proto__: { polluted: boolean } }).__proto__)
      .toEqual({ polluted: true });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('preserves additive fields and metadata while removing old provider fields', () => {
    const current = {
      ...webdav('Old'),
      schemaVersion: 1 as const,
      revision: 7,
      additive: { keep: true },
    };
    const replacement = replaceSyncConfigProvider(current, {
      provider: 'gdrive',
      clientId: '',
      clientSecret: '',
      lastSyncAt: null,
    }) as SyncConfig & Record<string, unknown>;

    expect(replacement).toMatchObject({
      provider: 'gdrive',
      schemaVersion: 1,
      revision: 7,
      additive: { keep: true },
    });
    expect(replacement).not.toHaveProperty('url');
    expect(replacement).not.toHaveProperty('password');
  });
});

function webdav(remotePath: string): Extract<SyncConfig, { provider: 'webdav' }> {
  return {
    provider: 'webdav',
    url: 'https://dav.example.test/root',
    username: 'user',
    password: 'secret',
    remotePath,
    lastSyncAt: null,
  };
}

function requireWebdav(
  config: SyncConfig,
): Extract<SyncConfig, { provider: 'webdav' }> {
  if (config.provider !== 'webdav') throw new Error('Expected WebDAV sync config');
  return config;
}

class MemorySyncConfigStorage implements SyncConfigStoragePort {
  present: boolean;
  value: unknown;
  reads = 0;
  writes = 0;
  readonly failReads = new Set<number>();
  readonly failBeforeWrites = new Set<number>();
  readonly commitThenFailWrites = new Set<number>();

  constructor(value?: unknown) {
    this.present = arguments.length > 0;
    this.value = clone(value);
  }

  async read() {
    this.reads += 1;
    if (this.failReads.has(this.reads)) throw new Error('Injected sync config read failure');
    return { present: this.present, value: clone(this.value) };
  }

  async write(value: VersionedSyncConfig) {
    this.writes += 1;
    if (this.failBeforeWrites.has(this.writes)) throw new Error('Injected sync config write failure');
    this.present = true;
    this.value = clone(value);
    if (this.commitThenFailWrites.has(this.writes)) {
      throw new Error('Injected lost sync config write response');
    }
  }
}

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}
