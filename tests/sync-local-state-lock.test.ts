import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { withSyncLocalStateLock } from '../core/persistence/local-state-lock';

describe('sync-owned local-state mutation lock', () => {
  it('serializes ordinary writes outside an in-flight sync apply', async () => {
    const events: string[] = [];
    let releaseSync!: () => void;
    const syncGate = new Promise<void>((resolve) => {
      releaseSync = resolve;
    });

    const syncApply = withSyncLocalStateLock(async () => {
      events.push('sync:start');
      await syncGate;
      events.push('sync:end');
    });
    const ordinaryWrite = withSyncLocalStateLock(async () => {
      events.push('ordinary:write');
    });

    await vi.waitFor(() => expect(events).toEqual(['sync:start']));
    expect(events).toEqual(['sync:start']);
    releaseSync();
    await Promise.all([syncApply, ordinaryWrite]);
    expect(events).toEqual(['sync:start', 'sync:end', 'ordinary:write']);
  });

  it('routes every sync-owned ordinary mutator through the shared lock', () => {
    for (const path of [
      'core/memory/store.ts',
      'core/preset/store.ts',
      'core/project/store.ts',
      'core/saved-items/store.ts',
      'core/scenario/store.ts',
      'core/skill/registry.ts',
    ]) {
      expect(readFileSync(path, 'utf8')).toContain('withSyncLocalStateLock');
    }
    expect(readFileSync('core/sync/local-apply-runtime.ts', 'utf8'))
      .toContain('withSyncLocalStateLock');
  });
});
