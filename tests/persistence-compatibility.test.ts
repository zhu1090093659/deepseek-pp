import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ARTIFACT_PERSISTENCE_CONTRACT,
  ARTIFACT_SCHEMA_VERSION,
  getArtifacts,
  isArtifactRecord,
} from '../core/artifact';
import {
  MEMORY_DATABASE_NAME,
  MEMORY_TABLE_NAME,
  MEMORY_TABLE_SCHEMAS,
  migrateMemoryV1RecordToV2,
  migrateMemoryV2RecordToV3,
} from '../core/memory/schema';
import {
  normalizeProjectContextState,
  PROJECT_CONTEXT_SCHEMA_VERSION,
  PROJECT_CONTEXT_STORAGE_KEY,
} from '../core/project';
import {
  normalizeSavedItemsState,
  SAVED_ITEMS_SCHEMA_VERSION,
  SAVED_ITEMS_STORAGE_KEY,
} from '../core/saved-items';
import {
  getAllScenarios,
  getDefaultScenarios,
  SCENARIO_STORAGE_KEY,
} from '../core/scenario/store';
import { SYNC_CONFIG_STORAGE_KEY } from '../core/sync/config';
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
  validatePreset,
  validateProjectContextState,
  validateSavedItemsState,
  validateSkill,
  validateSkillImportSource,
  validateSyncMemory,
} from '../core/sync/schema';
import {
  ARTIFACT_CURRENT_GAPS,
  ARTIFACT_FILTERING_DATA_LOSS_GAP,
  LEGAL_LEGACY_ARTIFACT_STORAGE,
  LEGACY_ARTIFACT_RECORD,
} from './fixtures/persistence-contract/artifact';
import {
  MEMORY_CURRENT_GAPS,
  MEMORY_V1_RECORD,
  MEMORY_V2_RECORD,
  MEMORY_V3_RECORD,
} from './fixtures/persistence-contract/memory';
import {
  PROJECT_V1_MIGRATION_REQUIREMENT,
  PROJECT_V2_STATE,
} from './fixtures/persistence-contract/project';
import {
  LEGACY_SAVED_ITEMS_ARRAY,
  SAVED_ITEMS_FUTURE_VERSION_GAP,
  SAVED_ITEMS_V1_STATE,
} from './fixtures/persistence-contract/saved-items';
import {
  SCENARIO_CURRENT_GAP,
  SCENARIO_STORAGE,
} from './fixtures/persistence-contract/scenario';
import {
  SYNC_CURRENT_GAPS,
  SYNC_JSON_FIXTURES,
  SYNC_LEGACY_JSON_FIXTURES,
  SYNC_LOCAL_APPLY_JOURNAL_V1_FIXTURE,
  SYNC_MEMORY_RECORD,
} from './fixtures/persistence-contract/sync';

let storage: Record<string, unknown>;
let storageGet: ReturnType<typeof vi.fn>;

beforeEach(() => {
  storage = {};
  storageGet = vi.fn(async (key: string) => ({ [key]: storage[key] }));
  vi.stubGlobal('indexedDB', undefined);
  vi.stubGlobal('IDBKeyRange', undefined);
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: storageGet,
        set: vi.fn(async (values: Record<string, unknown>) => {
          storage = { ...storage, ...values };
        }),
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
    expect(MEMORY_CURRENT_GAPS[0].target)
      .toBe('preserve-future-database-without-overwrite-after-T3.3');
    expect(MEMORY_CURRENT_GAPS[1]).toMatchObject({
      currentBehavior: 'next-memory-id-may-skip-after-rollback',
      target: 'define-logical-id-allocation-with-schema-migration-after-T3.3',
    });
  });

  it('reads legal legacy artifacts and classifies malformed filtering as a migration gap', async () => {
    expect(ARTIFACT_SCHEMA_VERSION).toBe(1);
    expect(ARTIFACT_PERSISTENCE_CONTRACT).toEqual({
      databaseName: 'DeepSeekPPArtifacts',
      databaseVersion: 1,
      tableName: 'artifacts',
      tableSchema: 'id, createdAt',
      legacyStorageKey: 'deepseek_pp_artifacts',
      maxRecords: 50,
    });
    storage[ARTIFACT_PERSISTENCE_CONTRACT.legacyStorageKey] = LEGAL_LEGACY_ARTIFACT_STORAGE;

    expect(isArtifactRecord(LEGACY_ARTIFACT_RECORD)).toBe(true);
    expect(isArtifactRecord(ARTIFACT_FILTERING_DATA_LOSS_GAP.input[1])).toBe(false);
    await expect(getArtifacts()).resolves.toEqual([LEGACY_ARTIFACT_RECORD]);
    expect(ARTIFACT_CURRENT_GAPS.map((gap) => gap.target))
      .toEqual([
        'preserve-unread-rows-for-explicit-recovery-after-T3.3',
        'single-authoritative-store-after-T3.3',
        'single-authoritative-store-after-T3.3',
      ]);
  });

  it('accepts Project v2 while classifying released Project v1 reset as data loss', () => {
    expect(PROJECT_CONTEXT_SCHEMA_VERSION).toBe(2);
    expect(PROJECT_CONTEXT_STORAGE_KEY).toBe('deepseek_pp_project_context');
    expect(normalizeProjectContextState(PROJECT_V2_STATE)).toEqual(PROJECT_V2_STATE);
    expect(normalizeProjectContextState(PROJECT_V1_MIGRATION_REQUIREMENT.input))
      .toEqual(PROJECT_V1_MIGRATION_REQUIREMENT.currentOutput);
    expect(PROJECT_V1_MIGRATION_REQUIREMENT.classification).toBe('current-data-loss-gap');
    expect(PROJECT_V1_MIGRATION_REQUIREMENT.target)
      .toBe('migrate-v1-without-overwrite-after-T3.3');
  });

  it('preserves saved-items legacy arrays and v1 while exposing future-version downgrade', () => {
    expect(SAVED_ITEMS_SCHEMA_VERSION).toBe(1);
    expect(SAVED_ITEMS_STORAGE_KEY).toBe('deepseek_pp_saved_items');
    expect(normalizeSavedItemsState(LEGACY_SAVED_ITEMS_ARRAY)).toEqual(SAVED_ITEMS_V1_STATE);
    expect(normalizeSavedItemsState(SAVED_ITEMS_V1_STATE)).toEqual(SAVED_ITEMS_V1_STATE);
    expect(normalizeSavedItemsState(SAVED_ITEMS_FUTURE_VERSION_GAP.input))
      .toEqual(SAVED_ITEMS_FUTURE_VERSION_GAP.currentOutput);
    expect(SAVED_ITEMS_FUTURE_VERSION_GAP.target).toBe('reject-without-overwrite-after-T3.3');
  });

  it('merges released scenario storage and records the broad read fallback as a current gap', async () => {
    expect(SCENARIO_STORAGE_KEY).toBe('scenarioConfigs');
    storage[SCENARIO_STORAGE_KEY] = SCENARIO_STORAGE;

    const scenarios = await getAllScenarios();
    expect(scenarios.find((scenario) => scenario.id === 'summarize')).toEqual({
      id: 'summarize',
      label: '总结',
      template: 'Custom summary template: {text}',
      builtIn: true,
      enabled: false,
    });
    expect(scenarios.find((scenario) => scenario.id === 'custom_contract'))
      .toEqual(SCENARIO_STORAGE[1]);

    storageGet.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(getAllScenarios()).resolves.toEqual(getDefaultScenarios());
    expect(SCENARIO_CURRENT_GAP.target)
      .toBe('surface-read-failure-without-overwrite-after-T3.3');
  });

  it('preserves fixed sync and configuration keys and decodes all six JSON files', () => {
    expect(SYNC_CONFIG_STORAGE_KEY).toBe('deepseek_pp_sync_config');
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
      validateProjectContextState,
    )).toEqual(PROJECT_V2_STATE);
    expect(parseValidatedJson(
      SYNC_FILE_KEYS.savedItems,
      syncFixture(SYNC_FILE_KEYS.savedItems),
      validateSavedItemsState,
    )).toEqual(SAVED_ITEMS_V1_STATE);
    expect(validateProjectContextState(SYNC_LEGACY_JSON_FIXTURES.projectContextWithoutVersion))
      .toEqual(PROJECT_V2_STATE);
    expect(validateSavedItemsState(SYNC_LEGACY_JSON_FIXTURES.savedItemsWithoutVersion))
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

  it('keeps remaining sync migration failures out of the legal contract', () => {
    expect(() => parseValidatedJson(
      SYNC_FILE_KEYS.projectContext,
      SYNC_CURRENT_GAPS[0].content,
      validateProjectContextState,
    )).toThrow('project-context.json.schemaVersion is not supported');
    expect(() => parseValidatedJson(
      SYNC_FILE_KEYS.savedItems,
      SYNC_CURRENT_GAPS[1].content,
      validateSavedItemsState,
    )).toThrow('saved-items.json.schemaVersion is not supported');
    expect(() => parseValidatedJson('memories.json', '{bad json}', (value) => value))
      .toThrow('云端 memories.json 不是有效 JSON，已停止下载');
    expect(SYNC_CURRENT_GAPS.map((gap) => gap.target)).toEqual([
      'migrate-v1-without-overwrite-after-T3.3',
      'unify-future-version-rejection-after-T3.3',
    ]);
  });
});

function syncFixture(key: string): string {
  const fixture = SYNC_JSON_FIXTURES.find((candidate) => candidate.key === key);
  if (!fixture) throw new Error(`Missing sync fixture: ${key}`);
  return fixture.content;
}
