import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVE_PRESET_STORAGE_KEY,
  PRESETS_STORAGE_KEY,
  getActivePreset,
  replacePresetCollectionForSyncApply,
  savePreset,
  setActivePresetId,
  stageDeletePresetAlreadyLocked,
} from '../core/preset/store';
import {
  SKILLS_STORAGE_KEY,
  SKILL_SOURCES_STORAGE_KEY,
  replaceAllCustomSkillsForSyncApply,
  replaceAllSkillSourcesForSyncApply,
  saveSkill,
  setSkillsEnabled,
  stageDeleteSkillAlreadyLocked,
  stageUpsertGitHubSkillSourceAlreadyLocked,
  updateGitHubSkillSourceLastCheckedAt,
} from '../core/skill/registry';
import {
  LEGACY_CUSTOM_SKILL,
  LEGACY_GITHUB_SKILL_SOURCE,
  LEGACY_PRESET,
  LEGACY_REMOTE_SKILL,
} from './fixtures/persistence-contract/skill-preset-history';

let storage: Record<string, unknown>;

beforeEach(() => {
  storage = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => (
          Object.prototype.hasOwnProperty.call(storage, key)
            ? { [key]: structuredClone(storage[key]) }
            : {}
        )),
        set: vi.fn(async (patch: Record<string, unknown>) => {
          storage = { ...storage, ...structuredClone(patch) };
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

describe('remaining local-state stores', () => {
  it('preserves additive fields while editing released Skill and Preset records', async () => {
    storage[SKILLS_STORAGE_KEY] = [LEGACY_CUSTOM_SKILL];
    storage[PRESETS_STORAGE_KEY] = [LEGACY_PRESET];

    await saveSkill({
      ...LEGACY_CUSTOM_SKILL,
      description: 'updated',
    });
    await savePreset({
      ...LEGACY_PRESET,
      name: 'updated',
    });

    expect(storage[SKILLS_STORAGE_KEY]).toEqual([{
      ...LEGACY_CUSTOM_SKILL,
      description: 'updated',
      enabled: true,
    }]);
    expect(storage[PRESETS_STORAGE_KEY]).toEqual([{
      ...LEGACY_PRESET,
      name: 'updated',
    }]);
  });

  it('updates only the current GitHub source check timestamp instead of replaying a stale source snapshot', async () => {
    const currentSource = {
      ...LEGACY_GITHUB_SKILL_SOURCE,
      commitSha: 'concurrent-update',
      skillPaths: ['updated/SKILL.md'],
    };
    storage[SKILL_SOURCES_STORAGE_KEY] = [currentSource];

    await expect(updateGitHubSkillSourceLastCheckedAt(currentSource.id, 99)).resolves.toEqual({
      ...currentSource,
      lastCheckedAt: 99,
    });
    expect(storage[SKILL_SOURCES_STORAGE_KEY]).toEqual([{
      ...currentSource,
      lastCheckedAt: 99,
    }]);
  });

  it('rejects a GitHub update plan when its selected source paths became stale during network I/O', async () => {
    storage[SKILLS_STORAGE_KEY] = [LEGACY_REMOTE_SKILL];
    storage[SKILL_SOURCES_STORAGE_KEY] = [{
      ...LEGACY_GITHUB_SKILL_SOURCE,
      skillPaths: ['new-selection/SKILL.md'],
    }];

    await expect(stageUpsertGitHubSkillSourceAlreadyLocked(
      LEGACY_GITHUB_SKILL_SOURCE,
      [LEGACY_REMOTE_SKILL],
      LEGACY_GITHUB_SKILL_SOURCE.skillPaths,
    )).rejects.toThrow('changed while its update was loading');
    expect(storage[SKILL_SOURCES_STORAGE_KEY]).toEqual([{
      ...LEGACY_GITHUB_SKILL_SOURCE,
      skillPaths: ['new-selection/SKILL.md'],
    }]);
  });

  it('cleans every linked source when historical duplicate Skill names are deleted', async () => {
    const secondSource = {
      ...LEGACY_GITHUB_SKILL_SOURCE,
      id: 'github:owner/other:main:.',
      repo: 'other',
      repository: 'owner/other',
      url: 'https://github.com/owner/other',
      repoUrl: 'https://github.com/owner/other',
      skillPaths: ['other/SKILL.md'],
    };
    const secondSkill = {
      ...LEGACY_REMOTE_SKILL,
      remote: {
        ...LEGACY_REMOTE_SKILL.remote,
        sourceId: secondSource.id,
        path: 'other/SKILL.md',
      },
    };
    storage[SKILLS_STORAGE_KEY] = [
      { ...LEGACY_CUSTOM_SKILL, name: LEGACY_REMOTE_SKILL.name },
      LEGACY_REMOTE_SKILL,
      secondSkill,
    ];
    storage[SKILL_SOURCES_STORAGE_KEY] = [LEGACY_GITHUB_SKILL_SOURCE, secondSource];

    const operation = await stageDeleteSkillAlreadyLocked(LEGACY_REMOTE_SKILL.name);
    await operation();

    expect(storage[SKILLS_STORAGE_KEY]).toEqual([]);
    expect(storage[SKILL_SOURCES_STORAGE_KEY]).toEqual([]);
  });

  it('rejects ambiguous duplicate-custom Skill edits without dropping released records', async () => {
    const duplicateSkills = [
      { ...LEGACY_CUSTOM_SKILL, additiveField: { record: 1 } },
      { ...LEGACY_CUSTOM_SKILL, additiveField: { record: 2 } },
    ];
    storage[SKILLS_STORAGE_KEY] = duplicateSkills;

    await expect(saveSkill({
      ...LEGACY_CUSTOM_SKILL,
      description: 'ambiguous edit',
    })).rejects.toThrow('ambiguous');
    expect(storage[SKILLS_STORAGE_KEY]).toEqual(duplicateSkills);
  });

  it('applies name-keyed enabled changes to every released duplicate Skill record', async () => {
    storage[SKILLS_STORAGE_KEY] = [
      { ...LEGACY_CUSTOM_SKILL, enabled: false, additiveField: { record: 1 } },
      { ...LEGACY_CUSTOM_SKILL, enabled: false, additiveField: { record: 2 } },
    ];

    await setSkillsEnabled([{ name: LEGACY_CUSTOM_SKILL.name, enabled: true }]);

    expect(storage[SKILLS_STORAGE_KEY]).toEqual([
      { ...LEGACY_CUSTOM_SKILL, enabled: true, additiveField: { record: 1 } },
      { ...LEGACY_CUSTOM_SKILL, enabled: true, additiveField: { record: 2 } },
    ]);
  });

  it('rejects malformed enabled mutations without defaulting them into a write', async () => {
    storage[SKILLS_STORAGE_KEY] = [LEGACY_CUSTOM_SKILL];

    await expect(setSkillsEnabled([{
      name: LEGACY_CUSTOM_SKILL.name,
      enabled: undefined as unknown as boolean,
    }])).rejects.toThrow('must be a boolean');
    expect(storage[SKILLS_STORAGE_KEY]).toEqual([LEGACY_CUSTOM_SKILL]);
  });

  it('rejects ambiguous duplicate-source updates without collapsing either record', async () => {
    const duplicateSources = [
      { ...LEGACY_GITHUB_SKILL_SOURCE, additiveField: { record: 1 } },
      { ...LEGACY_GITHUB_SKILL_SOURCE, additiveField: { record: 2 } },
    ];
    storage[SKILL_SOURCES_STORAGE_KEY] = duplicateSources;

    await expect(updateGitHubSkillSourceLastCheckedAt(
      LEGACY_GITHUB_SKILL_SOURCE.id,
      99,
    )).rejects.toThrow('duplicated');
    expect(storage[SKILL_SOURCES_STORAGE_KEY]).toEqual(duplicateSources);
  });

  it('rejects ambiguous duplicate-Preset edits without collapsing either record', async () => {
    const duplicatePresets = [
      { ...LEGACY_PRESET, additiveField: { record: 1 } },
      { ...LEGACY_PRESET, additiveField: { record: 2 } },
    ];
    storage[PRESETS_STORAGE_KEY] = duplicatePresets;

    await expect(savePreset({ ...LEGACY_PRESET, name: 'ambiguous edit' }))
      .rejects.toThrow('ambiguous');
    expect(storage[PRESETS_STORAGE_KEY]).toEqual(duplicatePresets);
  });

  it('rejects malformed Preset delete ids before staging a successful no-op', async () => {
    storage[PRESETS_STORAGE_KEY] = [LEGACY_PRESET];

    await expect(stageDeletePresetAlreadyLocked(42 as unknown as string))
      .rejects.toThrow('Preset id is required');
    expect(storage[PRESETS_STORAGE_KEY]).toEqual([LEGACY_PRESET]);
  });

  it('does not overwrite future or corrupt records during ordinary writes', async () => {
    const futureSkills = { schemaVersion: 99, records: [] };
    const corruptPresets = null;
    storage[SKILLS_STORAGE_KEY] = futureSkills;
    storage[PRESETS_STORAGE_KEY] = corruptPresets;

    await expect(saveSkill(LEGACY_CUSTOM_SKILL)).rejects.toThrow();
    await expect(savePreset(LEGACY_PRESET)).rejects.toThrow();
    expect(storage[SKILLS_STORAGE_KEY]).toEqual(futureSkills);
    expect(storage[PRESETS_STORAGE_KEY]).toBeNull();
  });

  it('does not let a valid sync snapshot overwrite unsupported local raw state', async () => {
    const futureSkills = { schemaVersion: 99, records: [] };
    const corruptSources = null;
    const futurePresets = { schemaVersion: 99, records: [] };
    storage[SKILLS_STORAGE_KEY] = futureSkills;
    storage[SKILL_SOURCES_STORAGE_KEY] = corruptSources;
    storage[PRESETS_STORAGE_KEY] = futurePresets;

    await expect(replaceAllCustomSkillsForSyncApply([LEGACY_CUSTOM_SKILL])).rejects.toThrow();
    await expect(replaceAllSkillSourcesForSyncApply([LEGACY_GITHUB_SKILL_SOURCE])).rejects.toThrow();
    await expect(replacePresetCollectionForSyncApply([LEGACY_PRESET])).rejects.toThrow();

    expect(storage[SKILLS_STORAGE_KEY]).toEqual(futureSkills);
    expect(storage[SKILL_SOURCES_STORAGE_KEY]).toBeNull();
    expect(storage[PRESETS_STORAGE_KEY]).toEqual(futurePresets);
  });

  it('rejects dangling active ids and preserves unsupported active state', async () => {
    storage[PRESETS_STORAGE_KEY] = [LEGACY_PRESET];
    storage[ACTIVE_PRESET_STORAGE_KEY] = 'historical-dangling';
    await expect(getActivePreset()).resolves.toBeNull();
    delete storage[ACTIVE_PRESET_STORAGE_KEY];

    await expect(setActivePresetId('missing')).rejects.toThrow('Preset was not found');
    expect(storage).not.toHaveProperty(ACTIVE_PRESET_STORAGE_KEY);

    const futureActive = { schemaVersion: 2, id: LEGACY_PRESET.id };
    storage[ACTIVE_PRESET_STORAGE_KEY] = futureActive;
    await expect(setActivePresetId(null)).rejects.toThrow('schemaVersion');
    expect(storage[ACTIVE_PRESET_STORAGE_KEY]).toEqual(futureActive);
  });
});
