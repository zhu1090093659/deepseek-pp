import { PROJECT_V1_STATE, PROJECT_V2_STATE } from './project';
import { SAVED_ITEMS_REJECTED_STATES, SAVED_ITEMS_V1_STATE } from './saved-items';

export const SYNC_CONFIG_STORAGE_FIXTURES = {
  providerlessWebdavV0: {
    url: 'https://dav.contract.test/root',
    username: 'contract-user',
    password: 'contract-password',
    remotePath: 'DeepSeekPP',
    lastSyncAt: null,
    additiveField: { preserve: true },
  },
  gdriveV1: {
    provider: 'gdrive',
    clientId: 'contract-client',
    clientSecret: 'contract-secret',
    refreshToken: 'contract-refresh',
    lastSyncAt: 1_700_000_000_000,
    schemaVersion: 1,
    revision: 9,
    additiveField: { preserve: true },
  },
  future: {
    provider: 'webdav',
    url: 'https://dav.contract.test/root',
    username: 'contract-user',
    password: 'contract-password',
    remotePath: 'DeepSeekPP',
    lastSyncAt: null,
    schemaVersion: 99,
    revision: 10,
  },
} as const;

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

export const SYNC_MEMORY_MISSING_SCOPE_ADDITIVE_RECORD = {
  ...SYNC_MEMORY_RECORD,
  id: 78,
  syncId: 'sync-remote-78',
  description: '',
  remoteAdditiveField: { preserve: true },
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

export const SYNC_GENERATION_V1_FIXTURE = {
  currentPointerKey: 'sync-current.json',
  manifestKey: 'sync-generation-fixture-generation-v1--manifest.json',
  files: [
    {
      logicalKey: 'memories.json',
      remoteKey: 'sync-generation-fixture-generation-v1--memories.json',
      content: '[]',
    },
    {
      logicalKey: 'skills.json',
      remoteKey: 'sync-generation-fixture-generation-v1--skills.json',
      content: '[]',
    },
    {
      logicalKey: 'skill-sources.json',
      remoteKey: 'sync-generation-fixture-generation-v1--skill-sources.json',
      content: '[]',
    },
    {
      logicalKey: 'presets.json',
      remoteKey: 'sync-generation-fixture-generation-v1--presets.json',
      content: '[]',
    },
    {
      logicalKey: 'project-context.json',
      remoteKey: 'sync-generation-fixture-generation-v1--project-context.json',
      content: '{"schemaVersion":2,"projects":[],"conversations":[],"pendingProjectId":null}',
    },
    {
      logicalKey: 'saved-items.json',
      remoteKey: 'sync-generation-fixture-generation-v1--saved-items.json',
      content: '{"schemaVersion":1,"items":[]}',
    },
  ],
  manifest:
    '{"kind":"deepseek-pp.sync-generation","schemaVersion":1,"generationId":"fixture-generation-v1","createdAt":1700000000000,"files":['
    + '{"key":"memories.json","byteLength":2,"checksum":{"algorithm":"sha256","value":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"}},'
    + '{"key":"skills.json","byteLength":2,"checksum":{"algorithm":"sha256","value":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"}},'
    + '{"key":"skill-sources.json","byteLength":2,"checksum":{"algorithm":"sha256","value":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"}},'
    + '{"key":"presets.json","byteLength":2,"checksum":{"algorithm":"sha256","value":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"}},'
    + '{"key":"project-context.json","byteLength":76,"checksum":{"algorithm":"sha256","value":"b0715642d984a4f006b9eb18cc2b463419ad4122a63b8e42f694de5a44a2c276"}},'
    + '{"key":"saved-items.json","byteLength":30,"checksum":{"algorithm":"sha256","value":"3fec395cc64c23628f3e5ed6765c32f77628cec39f588c470450dc3c81019a2c"}}]}',
  pointer:
    '{"kind":"deepseek-pp.sync-generation-pointer","schemaVersion":1,"generationId":"fixture-generation-v1","publishedAt":1700000000000,"manifestChecksum":{"algorithm":"sha256","value":"179fbfaa25be9585b73c1e93dbb104ca865d51250136cd4d6ab0b622bc845e37"}}',
} as const;

export const SYNC_LOCAL_APPLY_JOURNAL_V1_FIXTURE = {
  id: 'current',
  kind: 'deepseek-pp.sync-local-apply-journal',
  schemaVersion: 1,
  operationId: 'fixture-local-apply-v1',
  createdAt: 1_700_000_000_000,
  preimage: {
    memoryRecords: [{
      id: 77,
      syncId: 'sync-before-77',
      futureField: { preserved: true },
    }],
    storage: {
      skills: { present: true, value: [{ future: 'opaque-skill' }] },
      skillSources: { present: false },
      presets: { present: true, value: [{ id: 'preset-before' }] },
      activePreset: { present: true, value: 'preset-before' },
      projectContext: { present: true, value: { schemaVersion: 99, raw: true } },
      savedItems: { present: false },
    },
  },
  preimageChecksum: {
    algorithm: 'sha256',
    value: 'e307861ce4625fa36f1ba2747f7564b38b473d56f01a25403679216818c5f367',
  },
} as const;

export const SYNC_VERSIONING_FIXTURES = [
  {
    name: 'released project v1 sync state migrates losslessly',
    file: 'project-context.json',
    content: JSON.stringify(PROJECT_V1_STATE),
    expected: 'lossless-migration',
  },
  {
    name: 'explicit future saved-items sync state is rejected everywhere',
    file: 'saved-items.json',
    content: JSON.stringify(SAVED_ITEMS_REJECTED_STATES.future),
    expected: 'reject-without-overwrite',
  },
] as const;
