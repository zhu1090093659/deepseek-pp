import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ARTIFACT_PERSISTENCE_CONTRACT,
  decodeArtifactRecords,
  isArtifactRecord,
} from '../core/artifact/schema';
import { ARTIFACT_SCHEMA_VERSION } from '../core/artifact/types';
import {
  AUTOMATION_STORAGE_KEY,
  LEGACY_AUTOMATION_RUN_TIMEOUT_MS,
  decodeAutomationStorageState,
} from '../core/automation/storage-codec';
import {
  MEMORY_DATABASE_NAME,
  MEMORY_TABLE_NAME,
  MEMORY_TABLE_SCHEMAS,
  migrateMemoryV1RecordToV2,
  migrateMemoryV2RecordToV3,
} from '../core/memory/schema';
import {
  decodeProjectContextState,
  getProjectContextState,
  PROJECT_CONTEXT_SCHEMA_VERSION,
  PROJECT_CONTEXT_STORAGE_KEY,
} from '../core/project';
import {
  decodeSavedItemsState,
  getSavedItemsState,
  SAVED_ITEMS_SCHEMA_VERSION,
  SAVED_ITEMS_STORAGE_KEY,
} from '../core/saved-items';
import {
  getAllScenarios,
  SCENARIO_STORAGE_KEY,
} from '../core/scenario/store';
import { SYNC_CONFIG_STORAGE_KEY, decodeStoredSyncConfig } from '../core/sync/config';
import { TOOL_HISTORY_STORAGE_KEY } from '../core/tool/history';
import { decodeToolCallHistory } from '../core/tool/history-codec';
import { USAGE_STORAGE_KEY } from '../core/usage/store';
import { decodeUsageRecords } from '../core/usage/codec';
import {
  SYNC_RECOVERY_DATABASE_NAME,
  SYNC_RECOVERY_DATABASE_VERSION,
  SYNC_RECOVERY_JOURNAL_ID,
  SYNC_RECOVERY_JOURNAL_TABLE_NAME,
  SYNC_RECOVERY_JOURNAL_TABLE_SCHEMA,
} from '../core/sync/apply-journal';
import { validateSyncLocalApplyJournal } from '../core/sync/local-apply';
import {
  OPTIONAL_SYNC_FILE_KEYS,
  REQUIRED_SYNC_FILE_KEYS,
  SYNC_FILE_KEYS,
} from '../core/sync/contracts';
import {
  parseValidatedArray,
  parseValidatedJson,
  validateSyncMemory,
} from '../core/sync/schema';
import { decodePreset as validatePreset } from '../core/preset/codec';
import {
  decodeSkill as validateSkill,
  decodeSkillImportSource as validateSkillImportSource,
} from '../core/skill/codec';
import {
  ADDITIVE_LEGACY_ARTIFACT_RECORD,
  LEGAL_LEGACY_ARTIFACT_STORAGE,
  LEGACY_ARTIFACT_RECORD,
  REJECTED_LEGACY_ARTIFACT_STATES,
} from './fixtures/persistence-contract/artifact';
import {
  AUTOMATION_STORAGE_REJECTED_STATES,
  AUTOMATION_STORAGE_V1_LEGACY,
  AUTOMATION_STORAGE_V1_ORPHAN_RUN,
} from './fixtures/persistence-contract/automation';
import {
  MEMORY_BOUNDED_GAPS,
  MEMORY_V1_RECORD,
  MEMORY_V2_RECORD,
  MEMORY_V3_RECORD,
} from './fixtures/persistence-contract/memory';
import {
  PROJECT_REJECTED_STATES,
  PROJECT_V1_EMPTY_OPTIONAL_SOURCE_STATE,
  PROJECT_V1_MIGRATED_STATE,
  PROJECT_V1_STATE,
  PROJECT_V2_STATE,
} from './fixtures/persistence-contract/project';
import {
  LEGACY_SAVED_ITEMS_ARRAY,
  SAVED_ITEMS_REJECTED_STATES,
  SAVED_ITEMS_V1_STATE,
  SAVED_ITEMS_VERSIONLESS_STATE,
} from './fixtures/persistence-contract/saved-items';
import {
  SCENARIO_REJECTED_STATES,
  SCENARIO_STORAGE,
} from './fixtures/persistence-contract/scenario';
import {
  SYNC_JSON_FIXTURES,
  SYNC_CONFIG_STORAGE_FIXTURES,
  SYNC_LEGACY_JSON_FIXTURES,
  SYNC_LOCAL_APPLY_JOURNAL_V1_FIXTURE,
  SYNC_MEMORY_RECORD,
  SYNC_VERSIONING_FIXTURES,
} from './fixtures/persistence-contract/sync';
import {
  TOOL_HISTORY_LEGACY_RECORD,
  TOOL_HISTORY_STORAGE_REJECTED_STATES,
} from './fixtures/persistence-contract/tool-history';
import {
  USAGE_LEGACY_RECORD,
  USAGE_STORAGE_REJECTED_STATES,
} from './fixtures/persistence-contract/usage';

let storage: Record<string, unknown>;
let storageGet: ReturnType<typeof vi.fn>;
let storageSet: ReturnType<typeof vi.fn>;

beforeEach(() => {
  storage = {};
  storageGet = vi.fn(async (key: string) => ({ [key]: storage[key] }));
  storageSet = vi.fn(async (values: Record<string, unknown>) => {
    storage = { ...storage, ...values };
  });
  vi.stubGlobal('indexedDB', undefined);
  vi.stubGlobal('IDBKeyRange', undefined);
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: storageGet,
        set: storageSet,
        remove: vi.fn(async (key: string) => {
          delete storage[key];
        }),
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('persistence and sync compatibility contract', () => {
  it('freezes Memory v1-v3 identity, index declarations, and pure upgrade output', () => {
    expect(MEMORY_DATABASE_NAME).toBe('DeepSeekPP');
    expect(MEMORY_TABLE_NAME).toBe('memories');
    expect(MEMORY_TABLE_SCHEMAS).toEqual({
      1: '++id, type, name, pinned, createdAt, updatedAt, lastAccessedAt',
      2: '++id, type, name, pinned, createdAt, updatedAt, lastAccessedAt, syncId',
      3: '++id, type, name, pinned, createdAt, updatedAt, lastAccessedAt, syncId, scope, projectId',
    });

    expect(migrateMemoryV1RecordToV2(MEMORY_V1_RECORD, MEMORY_V2_RECORD.syncId))
      .toEqual(MEMORY_V2_RECORD);
    expect(migrateMemoryV2RecordToV3({ ...MEMORY_V2_RECORD, projectId: 'stale-project' }))
      .toEqual(MEMORY_V3_RECORD);
    expect(MEMORY_BOUNDED_GAPS).toEqual([{
      name: 'sync rollback restores raw rows but IndexedDB does not rewind its hidden auto-increment generator',
      currentBehavior: 'next-memory-id-may-skip-after-rollback',
      disposition: 'bounded-out-of-scope-no-second-allocator',
      target: 'preserve-released-auto-increment-and-allow-id-gaps',
    }]);
  });

  it('freezes Artifact identity and losslessly decodes the whole legal legacy array', () => {
    expect(ARTIFACT_SCHEMA_VERSION).toBe(1);
    expect(ARTIFACT_PERSISTENCE_CONTRACT).toEqual({
      databaseName: 'DeepSeekPPArtifacts',
      databaseVersion: 1,
      tableName: 'artifacts',
      tableSchema: 'id, createdAt',
      legacyStorageKey: 'deepseek_pp_artifacts',
      maxRecords: 50,
    });
    expect(isArtifactRecord(LEGACY_ARTIFACT_RECORD)).toBe(true);
    expect(isArtifactRecord(ADDITIVE_LEGACY_ARTIFACT_RECORD)).toBe(true);
    expect(decodeArtifactRecords(LEGAL_LEGACY_ARTIFACT_STORAGE))
      .toEqual(LEGAL_LEGACY_ARTIFACT_STORAGE);

    for (const raw of Object.values(REJECTED_LEGACY_ARTIFACT_STATES)) {
      expect(() => decodeArtifactRecords(raw)).toThrow();
    }
  });

  it('freezes Automation, Usage, and Tool History released whole-key contracts', () => {
    expect(AUTOMATION_STORAGE_KEY).toBe('deepseek_pp_automations');
    const automation = decodeAutomationStorageState(structuredClone(AUTOMATION_STORAGE_V1_LEGACY));
    expect(automation).toMatchObject({
      additiveRootField: { preserve: true },
      automations: [{
        deepseek: {
          chatSessionId: null,
          parentMessageId: null,
          sessionUrl: null,
          lastHistorySyncedAt: null,
        },
        additiveAutomationField: { preserve: true },
      }],
      runs: [{
        request: {
          parentMessageId: 42,
          deadlineAt: 1_100 + LEGACY_AUTOMATION_RUN_TIMEOUT_MS,
        },
        additiveRunField: { preserve: true },
      }],
    });
    expect(decodeAutomationStorageState(structuredClone(AUTOMATION_STORAGE_V1_ORPHAN_RUN)).runs)
      .toHaveLength(1);
    for (const raw of Object.values(AUTOMATION_STORAGE_REJECTED_STATES)) {
      expect(() => decodeAutomationStorageState(structuredClone(raw))).toThrow();
    }

    expect(USAGE_STORAGE_KEY).toBe('deepseek_pp_usage_turns_v1');
    expect(decodeUsageRecords(structuredClone([USAGE_LEGACY_RECORD]))[0]).toMatchObject({
      source: 'deepseek-web',
      chatSessionId: null,
      assistantMessageId: null,
      modelType: null,
      tokenSource: 'estimated',
      tps: 0,
      speedSource: 'estimated',
      elapsedMs: 0,
      messageCount: 2,
      additiveUsageField: { preserve: true },
    });
    for (const raw of Object.values(USAGE_STORAGE_REJECTED_STATES)) {
      expect(() => decodeUsageRecords(structuredClone(raw))).toThrow();
    }

    expect(TOOL_HISTORY_STORAGE_KEY).toBe('deepseek_pp_tool_history');
    expect(decodeToolCallHistory(structuredClone([TOOL_HISTORY_LEGACY_RECORD])))
      .toEqual([TOOL_HISTORY_LEGACY_RECORD]);
    for (const raw of Object.values(TOOL_HISTORY_STORAGE_REJECTED_STATES)) {
      expect(() => decodeToolCallHistory(structuredClone(raw))).toThrow();
    }
  });

  it('migrates released Project v1 losslessly without writing during reads', async () => {
    expect(PROJECT_CONTEXT_SCHEMA_VERSION).toBe(2);
    expect(PROJECT_CONTEXT_STORAGE_KEY).toBe('deepseek_pp_project_context');
    expect(decodeProjectContextState(PROJECT_V2_STATE)).toEqual(PROJECT_V2_STATE);
    expect(decodeProjectContextState(PROJECT_V1_STATE)).toEqual(PROJECT_V1_MIGRATED_STATE);
    expect(decodeProjectContextState(PROJECT_V1_EMPTY_OPTIONAL_SOURCE_STATE)).toEqual({
      ...PROJECT_V1_EMPTY_OPTIONAL_SOURCE_STATE,
      schemaVersion: 2,
      conversations: [],
      pendingProjectId: null,
    });

    storage[PROJECT_CONTEXT_STORAGE_KEY] = PROJECT_V1_STATE;
    await expect(getProjectContextState()).resolves.toEqual(PROJECT_V1_MIGRATED_STATE);
    expect(storage[PROJECT_CONTEXT_STORAGE_KEY]).toBe(PROJECT_V1_STATE);
    expect(storageSet).not.toHaveBeenCalled();
  });

  it('preserves all legal saved-items shapes exactly and rejects future/corrupt values', async () => {
    expect(SAVED_ITEMS_SCHEMA_VERSION).toBe(1);
    expect(SAVED_ITEMS_STORAGE_KEY).toBe('deepseek_pp_saved_items');
    expect(decodeSavedItemsState(LEGACY_SAVED_ITEMS_ARRAY)).toEqual(SAVED_ITEMS_V1_STATE);
    expect(decodeSavedItemsState(SAVED_ITEMS_V1_STATE)).toEqual(SAVED_ITEMS_V1_STATE);
    expect(decodeSavedItemsState(SAVED_ITEMS_VERSIONLESS_STATE)).toEqual({
      ...SAVED_ITEMS_VERSIONLESS_STATE,
      schemaVersion: 1,
    });

    for (const raw of Object.values(SAVED_ITEMS_REJECTED_STATES)) {
      storage[SAVED_ITEMS_STORAGE_KEY] = raw;
      await expect(getSavedItemsState()).rejects.toThrow();
      expect(storage[SAVED_ITEMS_STORAGE_KEY]).toBe(raw);
    }
    expect(storageSet).not.toHaveBeenCalled();
  });

  it('merges released scenario arrays while surfacing read and schema failures', async () => {
    expect(SCENARIO_STORAGE_KEY).toBe('scenarioConfigs');
    storage[SCENARIO_STORAGE_KEY] = SCENARIO_STORAGE;

    const scenarios = await getAllScenarios();
    expect(scenarios.find((scenario) => scenario.id === 'summarize')).toEqual({
      id: 'summarize',
      label: '总结',
      template: 'Custom summary template: {text}',
      builtIn: true,
      enabled: false,
      additiveField: { preserve: true },
    });
    expect(scenarios.find((scenario) => scenario.id === 'custom_contract'))
      .toEqual(SCENARIO_STORAGE[1]);

    storageGet.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(getAllScenarios()).rejects.toThrow('storage unavailable');

    for (const raw of Object.values(SCENARIO_REJECTED_STATES)) {
      storage[SCENARIO_STORAGE_KEY] = raw;
      await expect(getAllScenarios()).rejects.toThrow();
      expect(storage[SCENARIO_STORAGE_KEY]).toBe(raw);
    }
    expect(storageSet).not.toHaveBeenCalled();
  });

  it('preserves fixed sync and configuration keys and decodes all six JSON files', () => {
    expect(SYNC_CONFIG_STORAGE_KEY).toBe('deepseek_pp_sync_config');
    expect(decodeStoredSyncConfig(SYNC_CONFIG_STORAGE_FIXTURES.providerlessWebdavV0))
      .toMatchObject({
        revision: 0,
        config: {
          provider: 'webdav',
          schemaVersion: 1,
          revision: 0,
          additiveField: { preserve: true },
        },
      });
    expect(decodeStoredSyncConfig(SYNC_CONFIG_STORAGE_FIXTURES.gdriveV1))
      .toEqual({
        revision: 9,
        config: SYNC_CONFIG_STORAGE_FIXTURES.gdriveV1,
      });
    expect(() => decodeStoredSyncConfig(SYNC_CONFIG_STORAGE_FIXTURES.future))
      .toThrow('Sync configuration schema is not supported');
    expect(Object.values(SYNC_FILE_KEYS)).toEqual(SYNC_JSON_FIXTURES.map((fixture) => fixture.key));
    expect(REQUIRED_SYNC_FILE_KEYS).toEqual(
      SYNC_JSON_FIXTURES.filter((fixture) => fixture.required).map((fixture) => fixture.key),
    );
    expect(OPTIONAL_SYNC_FILE_KEYS).toEqual(
      SYNC_JSON_FIXTURES.filter((fixture) => !fixture.required).map((fixture) => fixture.key),
    );

    const memory = parseValidatedArray(
      SYNC_FILE_KEYS.memories,
      syncFixture(SYNC_FILE_KEYS.memories),
      validateSyncMemory,
    )[0];
    const { id: _id, ...memoryWithoutId } = SYNC_MEMORY_RECORD;
    expect(memory).toEqual({ ...memoryWithoutId, scope: 'global' });
    expect(parseValidatedArray(SYNC_FILE_KEYS.skills, syncFixture(SYNC_FILE_KEYS.skills), validateSkill))
      .toHaveLength(1);
    expect(parseValidatedArray(
      SYNC_FILE_KEYS.skillSources,
      syncFixture(SYNC_FILE_KEYS.skillSources),
      validateSkillImportSource,
    )).toHaveLength(1);
    expect(parseValidatedArray(SYNC_FILE_KEYS.presets, syncFixture(SYNC_FILE_KEYS.presets), validatePreset))
      .toHaveLength(1);
    expect(parseValidatedJson(
      SYNC_FILE_KEYS.projectContext,
      syncFixture(SYNC_FILE_KEYS.projectContext),
      decodeProjectContextState,
    )).toEqual(PROJECT_V2_STATE);
    expect(parseValidatedJson(
      SYNC_FILE_KEYS.savedItems,
      syncFixture(SYNC_FILE_KEYS.savedItems),
      decodeSavedItemsState,
    )).toEqual(SAVED_ITEMS_V1_STATE);
    expect(decodeProjectContextState(SYNC_LEGACY_JSON_FIXTURES.projectContextWithoutVersion))
      .toEqual(PROJECT_V2_STATE);
    expect(decodeSavedItemsState(SYNC_LEGACY_JSON_FIXTURES.savedItemsWithoutVersion))
      .toEqual(SAVED_ITEMS_V1_STATE);
  });

  it('freezes and executes the sync local-apply recovery journal raw v1 fixture', async () => {
    expect(SYNC_RECOVERY_DATABASE_NAME).toBe('DeepSeekPPSyncRecovery');
    expect(SYNC_RECOVERY_DATABASE_VERSION).toBe(1);
    expect(SYNC_RECOVERY_JOURNAL_TABLE_NAME).toBe('journal');
    expect(SYNC_RECOVERY_JOURNAL_TABLE_SCHEMA).toBe('&id');
    expect(SYNC_RECOVERY_JOURNAL_ID).toBe('current');
    await expect(validateSyncLocalApplyJournal(SYNC_LOCAL_APPLY_JOURNAL_V1_FIXTURE))
      .resolves.toMatchObject({
      kind: 'deepseek-pp.sync-local-apply-journal',
      schemaVersion: 1,
      operationId: 'fixture-local-apply-v1',
      preimage: SYNC_LOCAL_APPLY_JOURNAL_V1_FIXTURE.preimage,
      preimageChecksum: { algorithm: 'sha256' },
    });
  });

  it('migrates released sync state and rejects unsupported future versions', () => {
    expect(parseValidatedJson(
      SYNC_FILE_KEYS.projectContext,
      SYNC_VERSIONING_FIXTURES[0].content,
      decodeProjectContextState,
    )).toEqual(PROJECT_V1_MIGRATED_STATE);
    expect(() => parseValidatedJson(
      SYNC_FILE_KEYS.savedItems,
      SYNC_VERSIONING_FIXTURES[1].content,
      decodeSavedItemsState,
    )).toThrow('saved-items.json.schemaVersion is not supported');
    expect(() => parseValidatedJson('memories.json', '{bad json}', (value) => value))
      .toThrow('云端 memories.json 不是有效 JSON，已停止下载');
    expect(SYNC_VERSIONING_FIXTURES.map((fixture) => fixture.expected)).toEqual([
      'lossless-migration',
      'reject-without-overwrite',
    ]);
  });

  it('rejects future and corrupt Project states without overwriting their raw values', async () => {
    for (const raw of Object.values(PROJECT_REJECTED_STATES)) {
      storage[PROJECT_CONTEXT_STORAGE_KEY] = raw;
      await expect(getProjectContextState()).rejects.toThrow();
      expect(storage[PROJECT_CONTEXT_STORAGE_KEY]).toBe(raw);
    }
    expect(storageSet).not.toHaveBeenCalled();
  });
});

function syncFixture(key: string): string {
  const fixture = SYNC_JSON_FIXTURES.find((candidate) => candidate.key === key);
  if (!fixture) throw new Error(`Missing sync fixture: ${key}`);
  return fixture.content;
}
