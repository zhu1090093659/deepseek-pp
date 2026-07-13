import { PROJECT_V1_STATE, PROJECT_V2_STATE } from './project';
import { SAVED_ITEMS_V1_STATE } from './saved-items';

export const SYNC_MEMORY_RECORD = {
  id: 77,
  syncId: 'sync-remote-77',
  type: 'reference',
  name: 'Remote historical memory',
  content: 'Numeric id is removed and missing scope becomes global.',
  description: 'Remote compatibility fixture',
  tags: ['sync'],
  pinned: true,
  createdAt: 600,
  updatedAt: 610,
  accessCount: 3,
  lastAccessedAt: 620,
} as const;

export const SYNC_SKILL = {
  name: 'sync-contract-skill',
  description: 'Remote Skill contract',
  instructions: 'Preserve this instruction.',
  source: 'custom',
  memoryEnabled: false,
  enabled: true,
} as const;

export const SYNC_SKILL_SOURCE = {
  id: 'github:example/skills:main:.',
  provider: 'github',
  url: 'https://github.com/example/skills',
  owner: 'example',
  repo: 'skills',
  repository: 'example/skills',
  ref: 'main',
  rootPath: '',
  commitSha: 'abc123',
  defaultBranch: 'main',
  repoUrl: 'https://github.com/example/skills',
  skillPaths: ['SKILL.md'],
  importedSkillNames: ['sync-contract-skill'],
  importedAt: 630,
  updatedAt: 640,
} as const;

export const SYNC_PRESET = {
  id: 'preset-contract-1',
  name: 'Sync contract preset',
  content: 'Preserve this system prompt.',
  createdAt: 650,
  updatedAt: 660,
} as const;

export const SYNC_JSON_FIXTURES = [
  { key: 'memories.json', required: true, content: JSON.stringify([SYNC_MEMORY_RECORD]) },
  { key: 'skills.json', required: true, content: JSON.stringify([SYNC_SKILL]) },
  { key: 'skill-sources.json', required: false, content: JSON.stringify([SYNC_SKILL_SOURCE]) },
  { key: 'presets.json', required: true, content: JSON.stringify([SYNC_PRESET]) },
  { key: 'project-context.json', required: false, content: JSON.stringify(PROJECT_V2_STATE) },
  { key: 'saved-items.json', required: false, content: JSON.stringify(SAVED_ITEMS_V1_STATE) },
] as const;

export const SYNC_LEGACY_JSON_FIXTURES = {
  projectContextWithoutVersion: {
    projects: PROJECT_V2_STATE.projects,
    conversations: PROJECT_V2_STATE.conversations,
    pendingProjectId: PROJECT_V2_STATE.pendingProjectId,
  },
  savedItemsWithoutVersion: {
    items: SAVED_ITEMS_V1_STATE.items,
  },
} as const;

export const SYNC_CURRENT_GAPS = [
  {
    name: 'released project v1 sync state is rejected instead of migrated',
    file: 'project-context.json',
    content: JSON.stringify(PROJECT_V1_STATE),
    target: 'migrate-v1-without-overwrite-after-T3.3',
  },
  {
    name: 'explicit future saved-items sync state is rejected while the local decoder downgrades it',
    file: 'saved-items.json',
    content: JSON.stringify({ schemaVersion: 2, items: SAVED_ITEMS_V1_STATE.items }),
    target: 'unify-future-version-rejection-after-T3.3',
  },
  {
    name: 'parallel upload can publish a mixed remote snapshot without a generation marker',
    currentBehavior: 'parallel-fixed-file-overwrite',
    target: 'generation-atomic-upload-after-T2.4',
  },
  {
    name: 'parallel local replacement can partially apply a parsed remote snapshot',
    currentBehavior: 'parallel-multi-store-replacement',
    target: 'transactional-local-apply-after-T2.5',
  },
] as const;
