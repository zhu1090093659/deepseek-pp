import type {
  GitHubSkillSource,
  Skill,
  SystemPromptPreset,
} from '../../../core/types';

export const LEGACY_CUSTOM_SKILL = {
  name: 'legacy-custom',
  description: '',
  instructions: 'Keep the released bare-array record shape.',
  source: 'custom',
  memoryEnabled: false,
  additiveField: { preserve: true },
} satisfies Skill & { additiveField: { preserve: boolean } };

export const LEGACY_REMOTE_SKILL = {
  name: 'legacy-remote',
  description: 'Remote Skill',
  instructions: 'Use the imported source.',
  source: 'remote',
  memoryEnabled: true,
  enabled: false,
  remote: {
    provider: 'github',
    sourceId: 'github:owner/repo:main:.',
    sourceUrl: 'https://github.com/owner/repo',
    repository: 'owner/repo',
    ref: 'main',
    commitSha: 'abc123',
    path: 'SKILL.md',
    originalName: 'legacy-remote',
    importedAt: 1,
    updatedAt: 2,
    includedFiles: [],
    omittedFiles: [],
    warnings: [],
    additiveRemoteField: 'preserve',
  },
  additiveField: ['preserve'],
} satisfies Skill & {
  additiveField: string[];
  remote: NonNullable<Skill['remote']> & { additiveRemoteField: string };
};

export const LEGACY_GITHUB_SKILL_SOURCE = {
  id: 'github:owner/repo:main:.',
  provider: 'github',
  url: 'https://github.com/owner/repo',
  owner: 'owner',
  repo: 'repo',
  repository: 'owner/repo',
  ref: 'main',
  rootPath: '',
  commitSha: 'abc123',
  defaultBranch: 'main',
  repoUrl: 'https://github.com/owner/repo',
  skillPaths: ['SKILL.md'],
  importedSkillNames: ['legacy-remote'],
  importedAt: 1,
  updatedAt: 2,
  additiveField: { preserve: true },
} satisfies GitHubSkillSource & { additiveField: { preserve: boolean } };

export const LEGACY_PRESET = {
  id: 'preset-legacy',
  name: '',
  content: '',
  createdAt: 1,
  updatedAt: 2,
  additiveField: { preserve: true },
} satisfies SystemPromptPreset & { additiveField: { preserve: boolean } };

export const VERSIONLESS_HISTORY_STATE = {
  tagsBySessionId: {
    'session-one': [' release ', 'release', 'writing, research'],
  },
  additiveField: { preserve: true },
};

export const REMAINING_LOCAL_STATE_REJECTED_VALUES = [
  null,
  'corrupt',
  { schemaVersion: 99, records: [] },
] as const;
