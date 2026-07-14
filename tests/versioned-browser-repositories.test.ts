import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withSyncLocalStateLock } from '../core/persistence/local-state-lock';
import {
  createProjectContext,
  stageDeleteProjectContextAndMemoriesAlreadyLocked,
  getProjectContextState,
  updateProjectContext,
  type ProjectContextState,
} from '../core/project';
import {
  PROJECT_CONTEXT_STORAGE_KEY,
  saveProjectContextStateForSyncApply,
} from '../core/project/store';
import {
  getSavedItemsState,
  saveSavedItem,
  type SavedItemsState,
} from '../core/saved-items';
import {
  replaceSavedItemsStateForSyncApply,
  SAVED_ITEMS_STORAGE_KEY,
} from '../core/saved-items/store';
import {
  addCustomScenario,
  getAllScenarios,
  saveScenario,
  SCENARIO_STORAGE_KEY,
} from '../core/scenario/store';
import {
  PROJECT_REJECTED_STATES,
  PROJECT_V1_EMPTY_OPTIONAL_SOURCE_STATE,
  PROJECT_V1_MIGRATED_STATE,
  PROJECT_V1_STATE,
  PROJECT_V2_STATE,
} from './fixtures/persistence-contract/project';
import {
  SAVED_ITEMS_REJECTED_STATES,
  SAVED_ITEMS_V1_STATE,
} from './fixtures/persistence-contract/saved-items';
import {
  SCENARIO_REJECTED_STATES,
  SCENARIO_STORAGE,
} from './fixtures/persistence-contract/scenario';

const memoryMocks = vi.hoisted(() => ({
  assertValid: vi.fn(async () => undefined),
  deleteForProject: vi.fn(async () => 0),
}));

vi.mock('../core/memory/store', () => ({
  assertMemoryRecordsValidAlreadyLocked: memoryMocks.assertValid,
  deleteMemoriesForProjectAlreadyLocked: memoryMocks.deleteForProject,
}));

let storage: Record<string, unknown>;
let storageSet: ReturnType<typeof vi.fn>;
let randomUUID: ReturnType<typeof vi.fn>;

beforeEach(() => {
  storage = {};
  storageSet = vi.fn(async (patch: Record<string, unknown>) => {
    storage = { ...storage, ...structuredClone(patch) };
  });
  randomUUID = vi.fn(() => 'generated-id');
  vi.stubGlobal('crypto', { randomUUID });
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => (
          Object.prototype.hasOwnProperty.call(storage, key)
            ? { [key]: structuredClone(storage[key]) }
            : {}
        )),
        set: storageSet,
      },
    },
  });
  memoryMocks.deleteForProject.mockClear();
  memoryMocks.deleteForProject.mockResolvedValue(0);
  memoryMocks.assertValid.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('versioned browser repositories', () => {
  it('keeps storage routing and domain validation single-owned', () => {
    const repositorySource = readFileSync('core/persistence/versioned-repository.ts', 'utf8');
    expect(repositorySource).toContain('chrome.storage.local.get');
    expect(repositorySource).toContain('chrome.storage.local.set');

    for (const path of [
      'core/project/store.ts',
      'core/saved-items/store.ts',
      'core/scenario/store.ts',
    ]) {
      const source = readFileSync(path, 'utf8');
      expect(source).toContain('createVersionedRepository');
      expect(source).not.toContain('chrome.storage.local');
    }

    const syncSchema = readFileSync('core/sync/schema.ts', 'utf8');
    expect(syncSchema).not.toContain('validateProjectContextState');
    expect(syncSchema).not.toContain('validateSavedItemsState');
    expect(readFileSync('entrypoints/background/sync-runtime-service.ts', 'utf8'))
      .toContain('decodeProjectContextState');
    expect(readFileSync('entrypoints/background/sync-runtime-service.ts', 'utf8'))
      .toContain('decodeSavedItemsState');
    const projectSidebar = readFileSync(
      'entrypoints/content/adapters/project-sidebar-organizer.ts',
      'utf8',
    );
    expect(projectSidebar).toContain('decodeProjectContextState');
    expect(projectSidebar).not.toContain('function isProjectContextState');

    const background = readFileSync('entrypoints/background.ts', 'utf8');
    const contextMenuFunction = background.slice(
      background.indexOf('async function createContextMenus()'),
      background.indexOf('chrome.contextMenus.onClicked.addListener'),
    );
    const scenarioReadIndex = contextMenuFunction.indexOf('const scenarios = await getAllScenarios()');
    const destructiveRebuilds = [...contextMenuFunction.matchAll(/await chrome\.contextMenus\.removeAll\(\)/g)];
    expect(destructiveRebuilds).toHaveLength(2);
    expect(scenarioReadIndex).toBeGreaterThan(0);
    expect(scenarioReadIndex).toBeLessThan(destructiveRebuilds[1].index!);
  });

  it('distinguishes missing state from present null values', async () => {
    await expect(getProjectContextState()).resolves.toEqual({
      schemaVersion: 2,
      projects: [],
      conversations: [],
      pendingProjectId: null,
    });
    await expect(getSavedItemsState()).resolves.toEqual({ schemaVersion: 1, items: [] });
    await expect(getAllScenarios()).resolves.toMatchObject([
      { id: 'summarize' },
      { id: 'explain' },
      { id: 'translate' },
    ]);
    expect(storageSet).not.toHaveBeenCalled();

    storage[PROJECT_CONTEXT_STORAGE_KEY] = null;
    storage[SAVED_ITEMS_STORAGE_KEY] = null;
    storage[SCENARIO_STORAGE_KEY] = null;
    await expect(getProjectContextState()).rejects.toThrow('projectContext must be an object');
    await expect(getSavedItemsState()).rejects.toThrow('savedItems must be an object');
    await expect(getAllScenarios()).rejects.toThrow('scenarios must use the released array schema');
    expect(storageSet).not.toHaveBeenCalled();
  });

  it('persists a lossless Project v1 migration only on the first successful mutation', async () => {
    storage[PROJECT_CONTEXT_STORAGE_KEY] = PROJECT_V1_STATE;
    vi.spyOn(Date, 'now').mockReturnValue(900);

    await updateProjectContext('project-v1', { description: 'Updated description' });

    expect(storageSet).toHaveBeenCalledOnce();
    expect(storage[PROJECT_CONTEXT_STORAGE_KEY]).toEqual({
      ...PROJECT_V1_MIGRATED_STATE,
      projects: [{
        ...PROJECT_V1_MIGRATED_STATE.projects[0],
        description: 'Updated description',
        updatedAt: 900,
      }],
    });
  });

  it('removes intentionally deleted Project v1 legacy fields without leaving orphan files', async () => {
    storage[PROJECT_CONTEXT_STORAGE_KEY] = PROJECT_V1_STATE;

    await expect(withSyncLocalStateLock(async () => {
      const operation = await stageDeleteProjectContextAndMemoriesAlreadyLocked('project-v1');
      return operation();
    })).resolves.toBe(0);

    expect(storage[PROJECT_CONTEXT_STORAGE_KEY]).toEqual({
      ...PROJECT_V1_MIGRATED_STATE,
      projects: [],
      files: [],
      activeProjectId: null,
      activeFileIds: [],
    });
    expect(memoryMocks.deleteForProject).toHaveBeenCalledWith('project-v1');
  });

  it('keeps released empty optional Project v1 source fields through first mutation', async () => {
    storage[PROJECT_CONTEXT_STORAGE_KEY] = PROJECT_V1_EMPTY_OPTIONAL_SOURCE_STATE;
    vi.spyOn(Date, 'now').mockReturnValue(901);

    await updateProjectContext('project-empty-source', { description: 'Updated' });

    const persisted = storage[PROJECT_CONTEXT_STORAGE_KEY] as ProjectContextState & {
      projects: Array<ProjectContextState['projects'][number] & {
        source: Record<string, unknown>;
      }>;
    };
    expect(persisted.projects[0].source).toMatchObject({
      url: '',
      owner: '',
      repo: '',
      ref: '',
    });
  });

  it('preserves legal saved-item values exactly when a later item is added', async () => {
    const exactItem = {
      ...SAVED_ITEMS_V1_STATE.items[0],
      title: '  Existing title  ',
      content: '  Existing content  ',
      tags: [' duplicate ', ' duplicate '],
      additiveField: { preserve: true },
    };
    storage[SAVED_ITEMS_STORAGE_KEY] = {
      items: [exactItem],
      additiveStateField: { preserve: true },
    };
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    randomUUID
      .mockReturnValueOnce('new-item-id')
      .mockReturnValueOnce('new-sync-id');

    await saveSavedItem({
      kind: 'snippet',
      title: 'New item',
      content: 'New content',
      tags: [],
    });

    const persisted = storage[SAVED_ITEMS_STORAGE_KEY] as SavedItemsState;
    expect(persisted.schemaVersion).toBe(1);
    expect(persisted.items).toContainEqual(exactItem);
    expect(persisted).toMatchObject({ additiveStateField: { preserve: true } });
  });

  it('preserves additive Scenario fields while keeping built-in labels canonical', async () => {
    storage[SCENARIO_STORAGE_KEY] = SCENARIO_STORAGE;

    const summarize = (await getAllScenarios()).find((scenario) => scenario.id === 'summarize');
    expect(summarize).toMatchObject({
      label: '总结',
      template: 'Custom summary template: {text}',
      enabled: false,
      additiveField: { preserve: true },
    });
    await saveScenario({
      id: summarize!.id,
      label: summarize!.label,
      template: summarize!.template,
      builtIn: true,
      enabled: true,
    });

    expect((storage[SCENARIO_STORAGE_KEY] as Record<string, unknown>[])[0])
      .toMatchObject({ additiveField: { preserve: true }, enabled: true });

    await saveScenario({
      id: 'custom_contract',
      label: 'Updated contract',
      template: 'Updated: {text}',
      builtIn: false,
      enabled: false,
    });
    expect((storage[SCENARIO_STORAGE_KEY] as Record<string, unknown>[])
      .find((scenario) => scenario.id === 'custom_contract'))
      .toMatchObject({ additiveField: { preserve: 'custom' }, label: 'Updated contract' });
  });

  it('fails mutations before clocks, identifiers, or writes can touch future/corrupt state', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);

    for (const raw of Object.values(PROJECT_REJECTED_STATES)) {
      storage[PROJECT_CONTEXT_STORAGE_KEY] = raw;
      await expect(createProjectContext({ name: 'Blocked' })).rejects.toThrow();
      expect(storage[PROJECT_CONTEXT_STORAGE_KEY]).toBe(raw);
    }
    expect(randomUUID).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();

    for (const raw of Object.values(SAVED_ITEMS_REJECTED_STATES)) {
      storage[SAVED_ITEMS_STORAGE_KEY] = raw;
      await expect(saveSavedItem({
        kind: 'snippet',
        title: 'Blocked',
        content: 'Blocked',
        tags: [],
      })).rejects.toThrow();
      expect(storage[SAVED_ITEMS_STORAGE_KEY]).toBe(raw);
    }
    expect(randomUUID).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();

    for (const raw of Object.values(SCENARIO_REJECTED_STATES)) {
      storage[SCENARIO_STORAGE_KEY] = raw;
      await expect(addCustomScenario('Blocked', '{text}')).rejects.toThrow();
      expect(storage[SCENARIO_STORAGE_KEY]).toBe(raw);
    }
    expect(random).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
    expect(storageSet).not.toHaveBeenCalled();
  });

  it('guards sync replacements against overwriting local future state', async () => {
    storage[PROJECT_CONTEXT_STORAGE_KEY] = PROJECT_REJECTED_STATES.future;
    await expect(withSyncLocalStateLock(() => saveProjectContextStateForSyncApply(
      structuredClone(PROJECT_V2_STATE) as unknown as ProjectContextState,
    ))).rejects.toThrow('projectContext.schemaVersion is not supported');
    expect(storage[PROJECT_CONTEXT_STORAGE_KEY]).toBe(PROJECT_REJECTED_STATES.future);

    storage[SAVED_ITEMS_STORAGE_KEY] = SAVED_ITEMS_REJECTED_STATES.future;
    await expect(withSyncLocalStateLock(() => replaceSavedItemsStateForSyncApply(
      structuredClone(SAVED_ITEMS_V1_STATE) as unknown as SavedItemsState,
    ))).rejects.toThrow('savedItems.schemaVersion is not supported');
    expect(storage[SAVED_ITEMS_STORAGE_KEY]).toBe(SAVED_ITEMS_REJECTED_STATES.future);
    expect(storageSet).not.toHaveBeenCalled();
  });

  it('persists Saved Items sync envelope additive fields without truncation', async () => {
    storage[SAVED_ITEMS_STORAGE_KEY] = SAVED_ITEMS_V1_STATE;
    const remoteState = {
      ...SAVED_ITEMS_V1_STATE,
      additiveSyncField: { preserve: true },
    };

    await withSyncLocalStateLock(() => replaceSavedItemsStateForSyncApply(
      structuredClone(remoteState) as unknown as SavedItemsState,
    ));

    expect(storage[SAVED_ITEMS_STORAGE_KEY]).toEqual(remoteState);
  });

  it('serializes concurrent Project, Saved Items, and Scenario mutations without lost updates', async () => {
    randomUUID
      .mockReturnValueOnce('project-a')
      .mockReturnValueOnce('project-b')
      .mockReturnValueOnce('saved-a')
      .mockReturnValueOnce('sync-a')
      .mockReturnValueOnce('saved-b')
      .mockReturnValueOnce('sync-b');
    vi.spyOn(Date, 'now').mockReturnValue(2_000);
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.2);

    await Promise.all([
      createProjectContext({ name: 'Project A' }),
      createProjectContext({ name: 'Project B' }),
    ]);
    await expect(getProjectContextState()).resolves.toMatchObject({
      projects: [{ id: 'project-a' }, { id: 'project-b' }],
    });

    await Promise.all([
      saveSavedItem({ kind: 'snippet', title: 'A', content: 'A', tags: [] }),
      saveSavedItem({ kind: 'bookmark', title: 'B', content: 'B', tags: [] }),
    ]);
    await expect(getSavedItemsState()).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ id: 'saved-a' }),
        expect.objectContaining({ id: 'saved-b' }),
      ]),
    });

    await Promise.all([
      addCustomScenario('Scenario A', 'A: {text}'),
      addCustomScenario('Scenario B', 'B: {text}'),
    ]);
    const customScenarios = (await getAllScenarios()).filter((scenario) => !scenario.builtIn);
    expect(customScenarios.map((scenario) => scenario.label)).toEqual(['Scenario A', 'Scenario B']);
  });
});
