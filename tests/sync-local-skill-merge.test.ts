import { describe, expect, it } from 'vitest';
import { mergeLocalSkillImportsIntoSyncSnapshot } from '../core/sync/local-skill-merge';
import {
  isLocalOnlySkill,
  isLocalOnlySkillSource,
  isSyncableSkill,
  isSyncableSkillSource,
} from '../core/skill/sync-policy';
import type { LocalSkillSource, Skill, SkillImportSource } from '../core/types';
import { LEGACY_GITHUB_SKILL_SOURCE } from './fixtures/persistence-contract/skill-preset-history';

describe('mergeLocalSkillImportsIntoSyncSnapshot', () => {
  it('uses one complementary policy for local-only preservation and sync filtering', () => {
    const localSource = createLocalSource('local:/skills/demo', ['SKILL.md']);
    const localSkill = createLocalSkill('demo', localSource.id, 'SKILL.md');
    const customSkill = createCustomSkill('custom');
    const githubSource = LEGACY_GITHUB_SKILL_SOURCE;

    expect([isLocalOnlySkill(localSkill), isSyncableSkill(localSkill)]).toEqual([true, false]);
    expect([isLocalOnlySkill(customSkill), isSyncableSkill(customSkill)]).toEqual([false, true]);
    expect([isLocalOnlySkillSource(localSource), isSyncableSkillSource(localSource)])
      .toEqual([true, false]);
    expect([isLocalOnlySkillSource(githubSource), isSyncableSkillSource(githubSource)])
      .toEqual([false, true]);
  });

  it('renames local imports that collide with remote sync skills', () => {
    const localSource = createLocalSource('local:/skills/demo', ['SKILL.md']);
    const localSkill = createLocalSkill('demo', localSource.id, 'SKILL.md');

    const merged = mergeLocalSkillImportsIntoSyncSnapshot(
      {
        skills: [
          createCustomSkill('demo'),
          createCustomSkill('demo-2'),
        ],
        skillSources: [],
      },
      {
        skills: [localSkill],
        skillSources: [localSource],
      },
    );

    expect(merged.skills.map((skill) => skill.name)).toEqual(['demo', 'demo-2', 'demo-3']);
    expect(merged.skills[2]).toMatchObject({
      name: 'demo-3',
      remote: {
        provider: 'local',
        sourceId: localSource.id,
        path: 'SKILL.md',
      },
    });
    expect(merged.skillSources).toEqual([
      expect.objectContaining({
        id: localSource.id,
        importedSkillNames: ['demo-3'],
      }),
    ]);
  });

  it('preserves non-conflicting local import names and ignores syncable local state', () => {
    const localSource = createLocalSource('local:/skills/local-only', ['SKILL.md']);
    const githubSource = {
      id: 'github:owner/repo',
      provider: 'github',
      skillPaths: ['SKILL.md'],
      importedSkillNames: ['github-skill'],
    } as SkillImportSource;

    const merged = mergeLocalSkillImportsIntoSyncSnapshot(
      {
        skills: [createCustomSkill('remote-skill')],
        skillSources: [githubSource],
      },
      {
        skills: [
          createLocalSkill('local-only', localSource.id, 'SKILL.md'),
          createCustomSkill('local-custom'),
        ],
        skillSources: [localSource, githubSource],
      },
    );

    expect(merged.skills.map((skill) => skill.name)).toEqual(['remote-skill', 'local-only']);
    expect(merged.skillSources).toEqual([
      githubSource,
      expect.objectContaining({
        id: localSource.id,
        importedSkillNames: ['local-only'],
      }),
    ]);
  });
});

function createCustomSkill(name: string): Skill {
  return {
    name,
    description: `${name} description`,
    instructions: `${name} instructions`,
    source: 'custom',
    memoryEnabled: false,
    enabled: true,
  };
}

function createLocalSkill(name: string, sourceId: string, path: string): Skill {
  return {
    name,
    description: `${name} description`,
    instructions: `${name} instructions`,
    source: 'remote',
    memoryEnabled: false,
    enabled: true,
    remote: {
      provider: 'local',
      sourceId,
      path,
      originalName: name,
      importedAt: 1,
      updatedAt: 2,
      localRootPath: '/skills/demo',
      localDirectory: '/skills/demo',
      localDisplayName: 'demo',
      includedFiles: [],
      omittedFiles: [],
      warnings: [],
    },
  };
}

function createLocalSource(id: string, skillPaths: string[]): LocalSkillSource {
  return {
    id,
    provider: 'local',
    rootPath: '/skills/demo',
    displayName: 'demo',
    directoryName: 'demo',
    skillPaths,
    importedSkillNames: [],
    importedAt: 1,
    updatedAt: 2,
    warnings: [],
  };
}
