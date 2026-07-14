import { describe, expect, it, vi } from 'vitest';
import type { SyncCommandTarget, SyncConfig, SyncCounts } from '../core/types';
import {
  createSyncCommandTarget,
  createSyncConfigStore,
  type SyncConfigStoragePort,
  type VersionedSyncConfig,
} from '../core/sync/config';
import {
  createSyncCommandErrorResponse,
  createSyncOperationCoordinator,
  type SyncDownloadResult,
  type SyncOperationEffects,
} from '../core/sync/operation-coordinator';

const COUNTS: SyncCounts = {
  memories: 1,
  skills: 2,
  presets: 3,
  projects: 4,
  projectConversations: 5,
  savedItems: 6,
};

describe('sync operation coordinator', () => {
  it('uses the immutable confirmed target and stamps lastSyncAt through the same authority', async () => {
    const storage = new MemoryStorage();
    const seen: string[] = [];
    const coordinator = createCoordinator(storage, {
      upload: async (config) => {
        seen.push(config.provider === 'webdav' ? config.remotePath : config.provider);
        return COUNTS;
      },
      now: () => 123,
    });
    const payload = {
      config: webdav('Confirmed-A'),
      expectedRevision: null,
    };
    const operation = coordinator.upload(payload);
    payload.config.remotePath = 'Mutated-B';

    await expect(operation).resolves.toEqual({
      ok: true,
      lastSyncAt: 123,
      counts: COUNTS,
      revision: 2,
    });
    expect(seen).toEqual(['Confirmed-A']);
    expect(storage.value).toMatchObject({ remotePath: 'Confirmed-A', lastSyncAt: 123, revision: 2 });
  });

  it('serializes the entire action so a stale newer request cannot publish after it', async () => {
    const storage = new MemoryStorage();
    const firstStarted = deferred<void>();
    const releaseFirst = deferred<void>();
    const effectsSeen: string[] = [];
    const coordinator = createCoordinator(storage, {
      upload: async (config) => {
        const path = config.provider === 'webdav' ? config.remotePath : config.provider;
        effectsSeen.push(path);
        if (path === 'A') {
          firstStarted.resolve();
          await releaseFirst.promise;
        }
        return COUNTS;
      },
      now: () => 10,
    });

    const first = coordinator.upload(createSyncCommandTarget(webdav('A'), null));
    await firstStarted.promise;
    let readSettled = false;
    const queuedRead = coordinator.getConfig().then((value) => {
      readSettled = true;
      return value;
    });
    const staleSecond = coordinator.upload(createSyncCommandTarget(webdav('B'), null));
    await Promise.resolve();
    expect(readSettled).toBe(false);

    releaseFirst.resolve();
    await expect(first).resolves.toMatchObject({ revision: 2 });
    await expect(queuedRead).resolves.toMatchObject({ remotePath: 'A', revision: 2 });
    await expect(staleSecond).rejects.toMatchObject({ code: 'sync_config_conflict' });
    expect(effectsSeen).toEqual(['A']);
    expect(storage.value).toMatchObject({ remotePath: 'A', revision: 2 });
  });

  it('does not poison the queue after a remote failure and reports the committed config revision', async () => {
    const storage = new MemoryStorage();
    let testCalls = 0;
    const coordinator = createCoordinator(storage, {
      test: async () => {
        testCalls += 1;
        if (testCalls === 1) throw new Error('Injected provider failure');
      },
    });

    const first = coordinator.test(createSyncCommandTarget(webdav('A'), null));
    await expect(first).rejects.toThrow('Injected provider failure');
    const firstError = await first.catch((error) => error);
    expect(createSyncCommandErrorResponse(firstError)).toEqual({
      ok: false,
      error: 'Injected provider failure',
      code: 'sync_operation_failed_after_config_commit',
      revision: 1,
      lastSyncAt: null,
    });
    expect(storage.value).toMatchObject({ remotePath: 'A', revision: 1 });

    await expect(coordinator.test(createSyncCommandTarget(webdav('B'), 1)))
      .resolves.toEqual({ ok: true, revision: 2 });
    expect(storage.value).toMatchObject({ remotePath: 'B', revision: 2 });
  });

  it('rejects an authorization result when an external writer changes the target mid-flow', async () => {
    const storage = new MemoryStorage(versioned(gdrive('A'), 1));
    const authStarted = deferred<void>();
    const finishAuth = deferred<string>();
    const coordinator = createCoordinator(storage, {
      authorize: async () => {
        authStarted.resolve();
        return finishAuth.promise;
      },
    });

    const pending = coordinator.authorize(createSyncCommandTarget(gdrive('A'), 1));
    await authStarted.promise;
    storage.force(versioned(gdrive('B'), 2));
    finishAuth.resolve('refresh-for-A');

    const error = await pending.catch((failure) => failure);
    expect(createSyncCommandErrorResponse(error)).toEqual({
      ok: false,
      error: 'Sync configuration changed in another extension context. Review it and try again.',
      code: 'sync_operation_effect_completed_config_persist_failed',
      reloadConfig: true,
      effectCompleted: true,
    });
    expect(storage.value).toMatchObject({ clientId: 'B', revision: 2 });
    expect(storage.value).not.toHaveProperty('refreshToken', 'refresh-for-A');
  });

  it('rejects WebDAV authorization before the OAuth effect with the composed message', async () => {
    const storage = new MemoryStorage();
    const authorize = vi.fn(async () => 'unexpected-token');
    const coordinator = createCoordinator(storage, {
      authorize,
      authorizationNotRequiredMessage: () => '当前同步方式不需要授权',
    });

    await expect(coordinator.authorize(createSyncCommandTarget(webdav('A'), null)))
      .rejects.toThrow('当前同步方式不需要授权');
    expect(authorize).not.toHaveBeenCalled();
    expect(storage.present).toBe(false);
  });

  it('classifies a deterministic config write failure after OAuth completes', async () => {
    const storage = new MemoryStorage();
    storage.failBeforeWrites.add(1);
    const authorize = vi.fn(async () => 'refresh-token');
    const coordinator = createCoordinator(storage, { authorize });

    const error = await coordinator.authorize(createSyncCommandTarget(gdrive('A'), null))
      .catch((failure) => failure);

    expect(createSyncCommandErrorResponse(error)).toEqual({
      ok: false,
      error: 'Injected write failure',
      code: 'sync_operation_effect_completed_config_persist_failed',
      reloadConfig: true,
      effectCompleted: true,
    });
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(storage.present).toBe(false);
  });

  it('classifies an indeterminate config commit after OAuth completes without claiming a revision', async () => {
    const storage = new MemoryStorage();
    storage.commitThenFailWrites.add(1);
    storage.failReads.add(3);
    const coordinator = createCoordinator(storage, {
      authorize: async () => 'refresh-token',
    });

    const error = await coordinator.authorize(createSyncCommandTarget(gdrive('A'), null))
      .catch((failure) => failure);

    expect(createSyncCommandErrorResponse(error)).toEqual({
      ok: false,
      error: 'Sync configuration commit outcome is unknown',
      code: 'sync_operation_effect_completed_config_persist_failed',
      reloadConfig: true,
      effectCompleted: true,
    });
    expect(storage.value).toMatchObject({
      provider: 'gdrive',
      refreshToken: 'refresh-token',
      revision: 1,
    });
  });

  it('never starts remote work when config persistence fails before commit', async () => {
    const storage = new MemoryStorage();
    storage.failBeforeWrites.add(1);
    const upload = vi.fn(async () => COUNTS);
    const coordinator = createCoordinator(storage, { upload });

    await expect(coordinator.upload(createSyncCommandTarget(webdav('A'), null)))
      .rejects.toThrow('Injected write failure');
    expect(upload).not.toHaveBeenCalled();
    expect(storage.present).toBe(false);
  });

  it('continues after a committed-but-lost config response only when read-back proves the write', async () => {
    const storage = new MemoryStorage();
    storage.commitThenFailWrites.add(1);
    const upload = vi.fn(async () => COUNTS);
    const coordinator = createCoordinator(storage, { upload, now: () => 44 });

    await expect(coordinator.upload(createSyncCommandTarget(webdav('A'), null)))
      .resolves.toMatchObject({ ok: true, revision: 2, lastSyncAt: 44 });
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('keeps download apply/notification ordered and preserves target revision on apply failure', async () => {
    const storage = new MemoryStorage();
    const events: string[] = [];
    let fail = true;
    const result: SyncDownloadResult = {
      counts: COUNTS,
      projectContextChanged: true,
      savedItemsChanged: true,
    };
    const coordinator = createCoordinator(storage, {
      download: async () => {
        events.push('apply');
        if (fail) throw new Error('Injected local apply failure');
        return result;
      },
      now: () => 55,
    });

    const first = coordinator.download(createSyncCommandTarget(webdav('A'), null), async () => {
      events.push('notify');
    });
    const firstError = await first.catch((error) => error);
    expect(createSyncCommandErrorResponse(firstError)).toMatchObject({
      code: 'sync_operation_failed_after_config_commit',
      revision: 1,
    });
    expect(events).toEqual(['apply']);
    expect(storage.value).toMatchObject({ remotePath: 'A', lastSyncAt: null, revision: 1 });

    fail = false;
    await expect(coordinator.download(createSyncCommandTarget(webdav('B'), 1), async () => {
      events.push('notify');
    })).resolves.toMatchObject({ ok: true, lastSyncAt: 55, revision: 3 });
    expect(events).toEqual(['apply', 'apply', 'notify']);
    expect(storage.value).toMatchObject({ remotePath: 'B', lastSyncAt: 55, revision: 3 });
  });

  it('reports the committed timestamp when download notification fails', async () => {
    const storage = new MemoryStorage();
    const coordinator = createCoordinator(storage, { now: () => 77 });

    const error = await coordinator.download(
      createSyncCommandTarget(webdav('A'), null),
      async () => { throw new Error('Injected notification failure'); },
    ).catch((failure) => failure);

    expect(createSyncCommandErrorResponse(error)).toEqual({
      ok: false,
      error: 'Injected notification failure',
      code: 'sync_operation_failed_after_config_commit',
      revision: 2,
      lastSyncAt: 77,
      effectCompleted: true,
    });
    expect(storage.value).toMatchObject({ remotePath: 'A', lastSyncAt: 77, revision: 2 });
  });

  it('classifies an external config write after upload as completed-effect bookkeeping failure', async () => {
    const storage = new MemoryStorage();
    const upload = vi.fn(async () => {
      storage.force(versioned(webdav('External-B'), 2));
      return COUNTS;
    });
    const coordinator = createCoordinator(storage, { upload, now: () => 88 });

    const error = await coordinator.upload(createSyncCommandTarget(webdav('Confirmed-A'), null))
      .catch((failure) => failure);

    expect(createSyncCommandErrorResponse(error)).toEqual({
      ok: false,
      error: 'Sync configuration changed in another extension context. Review it and try again.',
      code: 'sync_operation_effect_completed_config_persist_failed',
      reloadConfig: true,
      effectCompleted: true,
    });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(storage.value).toMatchObject({ remotePath: 'External-B', revision: 2 });
  });

  it('does not claim an old baseline when the post-upload timestamp commit is indeterminate', async () => {
    const storage = new MemoryStorage();
    storage.commitThenFailWrites.add(2);
    storage.failReads.add(3);
    const coordinator = createCoordinator(storage, { now: () => 99 });

    const error = await coordinator.upload(createSyncCommandTarget(webdav('A'), null))
      .catch((failure) => failure);

    expect(createSyncCommandErrorResponse(error)).toEqual({
      ok: false,
      error: 'Sync configuration commit outcome is unknown',
      code: 'sync_operation_effect_completed_config_persist_failed',
      reloadConfig: true,
      effectCompleted: true,
    });
    expect(storage.value).toMatchObject({ remotePath: 'A', lastSyncAt: 99, revision: 2 });
  });
});

function createCoordinator(
  storage: MemoryStorage,
  overrides: Partial<SyncOperationEffects> = {},
) {
  return createSyncOperationCoordinator(createSyncConfigStore(storage), {
    test: overrides.test ?? (async () => {}),
    authorize: overrides.authorize ?? (async () => 'refresh'),
    upload: overrides.upload ?? (async () => COUNTS),
    download: overrides.download ?? (async () => ({
      counts: COUNTS,
      projectContextChanged: false,
      savedItemsChanged: false,
    })),
    authorizationNotRequiredMessage: overrides.authorizationNotRequiredMessage,
    now: overrides.now,
  });
}

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

function gdrive(clientId: string): Extract<SyncConfig, { provider: 'gdrive' }> {
  return {
    provider: 'gdrive',
    clientId,
    clientSecret: 'secret',
    lastSyncAt: null,
  };
}

function versioned(config: SyncConfig, revision: number): VersionedSyncConfig {
  return { ...config, schemaVersion: 1, revision } as VersionedSyncConfig;
}

class MemoryStorage implements SyncConfigStoragePort {
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
    if (this.failReads.has(this.reads)) throw new Error('Injected read failure');
    return { present: this.present, value: clone(this.value) };
  }

  async write(value: VersionedSyncConfig) {
    this.writes += 1;
    if (this.failBeforeWrites.has(this.writes)) throw new Error('Injected write failure');
    this.force(value);
    if (this.commitThenFailWrites.has(this.writes)) throw new Error('Injected lost response');
  }

  force(value: unknown) {
    this.present = true;
    this.value = clone(value);
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function clone<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}
