import type {
  GitHubSkillSource,
  LocalSkillSource,
  Memory,
  NewMemory,
  Skill,
  SkillImportSource,
  SkillSource,
  SystemPromptPreset,
} from '../types';
import {
  decodeImportedMemory,
  decodeStoredMemory,
  decodeSyncMemory,
} from '../memory/codec';
const SKILL_SOURCES: readonly SkillSource[] = ['builtin', 'third-party', 'official', 'custom', 'remote'];

export function parseValidatedArray<T>(
  file: string,
  content: string,
  validate: (value: unknown, path: string) => T,
): T[] {
  const parsed = parseValidatedJson(file, content, (value) => value);

  if (!Array.isArray(parsed)) {
    throw new Error(`云端 ${file} 格式错误，应为数组，已停止下载`);
  }

  return parsed.map((item, index) => validate(item, `${file}[${index}]`));
}

export function parseValidatedJson<T>(
  file: string,
  content: string,
  validate: (value: unknown, path: string) => T,
): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`云端 ${file} 不是有效 JSON，已停止下载`);
  }
  return validate(parsed, file);
}

export function validateStoredMemory(value: unknown, path = 'memory'): Omit<Memory, 'id'> {
  return decodeStoredMemory(value, path);
}

export function validateSyncMemory(value: unknown, path = 'memory'): Omit<Memory, 'id'> {
  return decodeSyncMemory(value, path);
}

export function validateImportedMemory(value: unknown, path = 'memory'): NewMemory {
  return decodeImportedMemory(value, path);
}

export function validateSkill(value: unknown, path = 'skill'): Skill {
  const object = objectValue(value, path);
  const source = enumValue(object.source, SKILL_SOURCES, `${path}.source`);
  return {
    name: requiredString(object.name, `${path}.name`),
    description: requiredString(object.description, `${path}.description`),
    instructions: requiredString(object.instructions, `${path}.instructions`),
    source,
    memoryEnabled: requiredBoolean(object.memoryEnabled, `${path}.memoryEnabled`),
    ...(object.enabled === undefined ? {} : { enabled: requiredBoolean(object.enabled, `${path}.enabled`) }),
    ...(object.metadata === undefined ? {} : { metadata: stringRecord(object.metadata, `${path}.metadata`) }),
    ...(object.remote === undefined ? {} : { remote: object.remote as Skill['remote'] }),
  };
}

export function validateGitHubSkillSource(value: unknown, path = 'skillSource'): GitHubSkillSource {
  const object = objectValue(value, path);
  if (object.provider !== 'github') throw new Error(`${path}.provider must be github`);
  return {
    id: requiredString(object.id, `${path}.id`),
    provider: 'github',
    url: requiredString(object.url, `${path}.url`),
    owner: requiredString(object.owner, `${path}.owner`),
    repo: requiredString(object.repo, `${path}.repo`),
    repository: requiredString(object.repository, `${path}.repository`),
    ref: requiredString(object.ref, `${path}.ref`),
    rootPath: requiredStringAllowEmpty(object.rootPath, `${path}.rootPath`),
    commitSha: requiredString(object.commitSha, `${path}.commitSha`),
    defaultBranch: requiredString(object.defaultBranch, `${path}.defaultBranch`),
    repoUrl: requiredString(object.repoUrl, `${path}.repoUrl`),
    skillPaths: stringArray(object.skillPaths, `${path}.skillPaths`),
    importedSkillNames: stringArray(object.importedSkillNames, `${path}.importedSkillNames`),
    importedAt: requiredFiniteNumber(object.importedAt, `${path}.importedAt`),
    updatedAt: requiredFiniteNumber(object.updatedAt, `${path}.updatedAt`),
    ...(object.lastCheckedAt === undefined ? {} : { lastCheckedAt: requiredFiniteNumber(object.lastCheckedAt, `${path}.lastCheckedAt`) }),
    ...(object.licenseName === undefined ? {} : { licenseName: requiredString(object.licenseName, `${path}.licenseName`) }),
    ...(object.licenseSpdxId === undefined ? {} : { licenseSpdxId: requiredString(object.licenseSpdxId, `${path}.licenseSpdxId`) }),
    ...(object.packageVersion === undefined ? {} : { packageVersion: requiredString(object.packageVersion, `${path}.packageVersion`) }),
    ...(object.description === undefined ? {} : { description: requiredString(object.description, `${path}.description`) }),
  };
}

export function validateSkillImportSource(value: unknown, path = 'skillSource'): SkillImportSource {
  const object = objectValue(value, path);
  if (object.provider === 'github') return validateGitHubSkillSource(value, path);
  if (object.provider === 'local') return validateLocalSkillSource(value, path);
  throw new Error(`${path}.provider must be github or local`);
}

export function validateLocalSkillSource(value: unknown, path = 'skillSource'): LocalSkillSource {
  const object = objectValue(value, path);
  if (object.provider !== 'local') throw new Error(`${path}.provider must be local`);
  return {
    id: requiredString(object.id, `${path}.id`),
    provider: 'local',
    rootPath: requiredString(object.rootPath, `${path}.rootPath`),
    displayName: requiredString(object.displayName, `${path}.displayName`),
    directoryName: requiredString(object.directoryName, `${path}.directoryName`),
    skillPaths: stringArray(object.skillPaths, `${path}.skillPaths`),
    importedSkillNames: stringArray(object.importedSkillNames, `${path}.importedSkillNames`),
    importedAt: requiredFiniteNumber(object.importedAt, `${path}.importedAt`),
    updatedAt: requiredFiniteNumber(object.updatedAt, `${path}.updatedAt`),
    warnings: stringArray(object.warnings, `${path}.warnings`),
    ...(object.lastCheckedAt === undefined ? {} : { lastCheckedAt: requiredFiniteNumber(object.lastCheckedAt, `${path}.lastCheckedAt`) }),
  };
}

export function validatePreset(value: unknown, path = 'preset'): SystemPromptPreset {
  const object = objectValue(value, path);
  return {
    id: requiredString(object.id, `${path}.id`),
    name: requiredString(object.name, `${path}.name`),
    content: requiredString(object.content, `${path}.content`),
    createdAt: requiredFiniteNumber(object.createdAt, `${path}.createdAt`),
    updatedAt: requiredFiniteNumber(object.updatedAt, `${path}.updatedAt`),
  };
}

function objectValue(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array`);
  }
  return value;
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

// GitHub skill sources use an empty rootPath to denote the repository root
// (consistent with createSourceId's `rootPath || '.'` fallback and the UI's
// `rootPath || repoRoot` display). Allow empty here so a snapshot uploaded from
// a repo-root import can be re-downloaded on a new device.
function requiredStringAllowEmpty(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${path} must be a string`);
  }
  return value;
}

function requiredBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean`);
  return value;
}

function requiredFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`);
  }
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${path} must be a string array`);
  }
  return [...value];
}

function stringRecord(value: unknown, path: string): Record<string, string> {
  const object = objectValue(value, path);
  const entries = Object.entries(object);
  if (!entries.every(([, item]) => typeof item === 'string')) {
    throw new Error(`${path} must be a string record`);
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${path} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}
