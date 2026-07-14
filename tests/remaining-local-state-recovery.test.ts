import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const memoryMocks = vi.hoisted(() => ({
  capture: vi.fn(async () => []),
  replace: vi.fn(),
  restore: vi.fn(),
}));

vi.mock('../core/memory/store', () => ({
  captureRawMemoryRecordsForSyncRecovery: memoryMocks.capture,
  replaceAllMemoriesForSyncApply: memoryMocks.replace,
  restoreRawMemoryRecordsForSyncRecovery: memoryMocks.restore,
}));

import {
  ACTIVE_PRESET_STORAGE_KEY,
  PRESETS_STORAGE_KEY,
  stageDeletePresetAlreadyLocked,
} from '../core/preset/store';
import {
  SKILLS_STORAGE_KEY,
  SKILL_SOURCES_STORAGE_KEY,
  stageDeleteSkillAlreadyLocked,
} from '../core/skill/registry';
import {
  createSyncLocalApplyCoordinator,
  type SyncLocalApplyJournalPort,
  type SyncLocalApplyJournalV1,
} from '../core/sync/local-apply';
import { browserSyncLocalStatePort } from '../core/sync/local-state-browser';
import {
  LEGACY_GITHUB_SKILL_SOURCE,
  LEGACY_PRESET,
  LEGACY_REMOTE_SKILL,
} from './fixtures/persistence-contract/skill-preset-history';

let storage: Record<string, unknown>;
let failNextWrite: { key: string; operation: 'set' | 'remove' } | null;

beforeEach(() => {
  storage = {};
  failNextWrite = null;
  memoryMocks.capture.mockClear();
  memoryMocks.restore.mockClear();
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          const requested = typeof keys === 'string' ? [keys] : keys;
          return Object.fromEntries(
            requested
              .filter((key) => Object.prototype.hasOwnProperty.call(storage, key))
              .map((key) => [key, structuredClone(storage[key])]),
          );
        }),
        set: vi.fn(async (patch: Record<string, unknown>) => {
          storage = { ...storage, ...structuredClone(patch) };
          if (failNextWrite?.operation === 'set' && failNextWrite.key in patch) {
            const failure = failNextWrite;
            failNextWrite = null;
            throw new Error(`write failed after ${failure.key}`);
          }
        }),
        remove: vi.fn(async (key: string) => {
          delete storage[key];
          if (failNextWrite?.operation === 'remove' && failNextWrite.key === key) {
            failNextWrite = null;
            throw new Error(`remove failed after ${key}`);
          }
        }),
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('remaining cross-key local-state recovery', () => {
  it('restores the exact Skill/Source preimage when the second write fails, then retries cleanly', async () => {
    storage = {
      [SKILLS_STORAGE_KEY]: [LEGACY_REMOTE_SKILL],
      [SKILL_SOURCES_STORAGE_KEY]: [LEGACY_GITHUB_SKILL_SOURCE],
      unrelated: { preserve: true },
    };
    const before = structuredClone(storage);
    const coordinator = createCoordinator();
    const operation = await stageDeleteSkillAlreadyLocked(LEGACY_REMOTE_SKILL.name);
    failNextWrite = { key: SKILL_SOURCES_STORAGE_KEY, operation: 'set' };

    await expect(coordinator.runMutation(operation)).rejects.toThrow('write failed after');
    expect(storage).toEqual(before);

    const retry = await stageDeleteSkillAlreadyLocked(LEGACY_REMOTE_SKILL.name);
    await expect(coordinator.runMutation(retry)).resolves.toBeUndefined();
    expect(storage).toEqual({
      [SKILLS_STORAGE_KEY]: [],
      [SKILL_SOURCES_STORAGE_KEY]: [],
      unrelated: { preserve: true },
    });
  });

  it('restores Preset and active-id together when active-id removal fails', async () => {
    storage = {
      [PRESETS_STORAGE_KEY]: [LEGACY_PRESET],
      [ACTIVE_PRESET_STORAGE_KEY]: LEGACY_PRESET.id,
    };
    const before = structuredClone(storage);
    const coordinator = createCoordinator();
    const operation = await stageDeletePresetAlreadyLocked(LEGACY_PRESET.id);
    failNextWrite = { key: ACTIVE_PRESET_STORAGE_KEY, operation: 'remove' };

    await expect(coordinator.runMutation(operation)).rejects.toThrow('remove failed after');
    expect(storage).toEqual(before);

    const retry = await stageDeletePresetAlreadyLocked(LEGACY_PRESET.id);
    await expect(coordinator.runMutation(retry)).resolves.toBeUndefined();
    expect(storage).toEqual({ [PRESETS_STORAGE_KEY]: [] });
  });
});

function createCoordinator() {
  return createSyncLocalApplyCoordinator(
    browserSyncLocalStatePort,
    new MemoryJournal(),
    {
      now: () => 1_700_000_000_000,
      createOperationId: () => crypto.randomUUID(),
    },
  );
}

class MemoryJournal implements SyncLocalApplyJournalPort {
  private current: SyncLocalApplyJournalV1 | null = null;

  async readCurrent(): Promise<unknown | null> {
    return this.current ? structuredClone(this.current) : null;
  }

  async writeCurrent(record: SyncLocalApplyJournalV1): Promise<void> {
    this.current = structuredClone(record);
  }

  async clearCurrent(): Promise<void> {
    this.current = null;
  }
}
