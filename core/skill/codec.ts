import type {
  GitHubSkillSource,
  ImportedSkillProvider,
  LocalSkillSource,
  RemoteSkillFile,
  RemoteSkillMetadata,
  Skill,
  SkillImportSource,
  SkillSource,
} from '../types';
import type { VersionedValueCodec } from '../persistence/versioned-repository';

export const SKILL_RECORD_SCHEMA_VERSION = 1 as const;
export const SKILL_SOURCE_RECORD_SCHEMA_VERSION = 1 as const;

const SKILL_SOURCES = new Set<SkillSource>([
  'builtin',
  'third-party',
  'official',
  'custom',
  'remote',
]);
const USER_SKILL_SOURCES = new Set<SkillSource>(['custom', 'remote']);
const IMPORTED_SKILL_PROVIDERS = new Set<ImportedSkillProvider>(['github', 'local']);

export const userSkillCollectionCodec: VersionedValueCodec<Skill[]> = {
  decode: decodeUserSkillCollection,
  encode(value) {
    return decodeUserSkillCollection(value, 'skills');
  },
};

export const skillSourceCollectionCodec: VersionedValueCodec<SkillImportSource[]> = {
  decode: decodeSkillSourceCollection,
  encode(value) {
    return decodeSkillSourceCollection(value, 'skillSources');
  },
};

export function decodeUserSkillCollection(value: unknown, path = 'skills'): Skill[] {
  return releasedArray(value, path)
    .map((item, index) => decodeUserSkill(item, `${path}[${index}]`));
}

export function decodeSkillLibrary(value: unknown, path = 'skills'): Skill[] {
  return releasedArray(value, path)
    .map((item, index) => decodeSkill(item, `${path}[${index}]`));
}

export function decodeUserSkill(value: unknown, path = 'skill'): Skill {
  const skill = decodeSkill(value, path);
  if (!USER_SKILL_SOURCES.has(skill.source)) {
    throw new Error(`${path}.source must be custom or remote`);
  }
  return skill;
}

export function decodeSkill(value: unknown, path = 'skill'): Skill {
  const object = recordValue(value, path);
  assertOptionalSchemaVersion(object.schemaVersion, SKILL_RECORD_SCHEMA_VERSION, path);
  const source = enumValue(object.source, SKILL_SOURCES, `${path}.source`);
  return {
    ...object,
    name: requiredString(object.name, `${path}.name`),
    description: stringValue(object.description, `${path}.description`),
    instructions: requiredString(object.instructions, `${path}.instructions`),
    source,
    memoryEnabled: booleanValue(object.memoryEnabled, `${path}.memoryEnabled`),
    enabled: object.enabled === undefined
      ? true
      : booleanValue(object.enabled, `${path}.enabled`),
    ...(object.metadata === undefined
      ? {}
      : { metadata: stringRecord(object.metadata, `${path}.metadata`) }),
    ...(object.remote === undefined
      ? {}
      : { remote: decodeRemoteSkillMetadata(object.remote, `${path}.remote`) }),
  } as Skill;
}

export function decodeSkillSourceCollection(
  value: unknown,
  path = 'skillSources',
): SkillImportSource[] {
  return releasedArray(value, path)
    .map((item, index) => decodeSkillImportSource(item, `${path}[${index}]`));
}

export function decodeSkillImportSource(
  value: unknown,
  path = 'skillSource',
): SkillImportSource {
  const object = recordValue(value, path);
  if (object.provider === 'github') return decodeGitHubSkillSource(object, path);
  if (object.provider === 'local') return decodeLocalSkillSource(object, path);
  throw new Error(`${path}.provider must be github or local`);
}

export function decodeGitHubSkillSource(
  value: unknown,
  path = 'skillSource',
): GitHubSkillSource {
  const object = recordValue(value, path);
  assertOptionalSchemaVersion(object.schemaVersion, SKILL_SOURCE_RECORD_SCHEMA_VERSION, path);
  if (object.provider !== 'github') throw new Error(`${path}.provider must be github`);
  return {
    ...object,
    id: requiredString(object.id, `${path}.id`),
    provider: 'github',
    url: requiredString(object.url, `${path}.url`),
    owner: requiredString(object.owner, `${path}.owner`),
    repo: requiredString(object.repo, `${path}.repo`),
    repository: requiredString(object.repository, `${path}.repository`),
    ref: requiredString(object.ref, `${path}.ref`),
    rootPath: stringValue(object.rootPath, `${path}.rootPath`),
    commitSha: requiredString(object.commitSha, `${path}.commitSha`),
    defaultBranch: requiredString(object.defaultBranch, `${path}.defaultBranch`),
    repoUrl: requiredString(object.repoUrl, `${path}.repoUrl`),
    skillPaths: stringArray(object.skillPaths, `${path}.skillPaths`),
    importedSkillNames: stringArray(object.importedSkillNames, `${path}.importedSkillNames`),
    importedAt: finiteNumber(object.importedAt, `${path}.importedAt`),
    updatedAt: finiteNumber(object.updatedAt, `${path}.updatedAt`),
    ...(object.lastCheckedAt === undefined
      ? {}
      : { lastCheckedAt: finiteNumber(object.lastCheckedAt, `${path}.lastCheckedAt`) }),
    ...(object.licenseName === undefined
      ? {}
      : { licenseName: stringValue(object.licenseName, `${path}.licenseName`) }),
    ...(object.licenseSpdxId === undefined
      ? {}
      : { licenseSpdxId: stringValue(object.licenseSpdxId, `${path}.licenseSpdxId`) }),
    ...(object.packageVersion === undefined
      ? {}
      : { packageVersion: stringValue(object.packageVersion, `${path}.packageVersion`) }),
    ...(object.description === undefined
      ? {}
      : { description: stringValue(object.description, `${path}.description`) }),
  } as GitHubSkillSource;
}

export function decodeLocalSkillSource(
  value: unknown,
  path = 'skillSource',
): LocalSkillSource {
  const object = recordValue(value, path);
  assertOptionalSchemaVersion(object.schemaVersion, SKILL_SOURCE_RECORD_SCHEMA_VERSION, path);
  if (object.provider !== 'local') throw new Error(`${path}.provider must be local`);
  return {
    ...object,
    id: requiredString(object.id, `${path}.id`),
    provider: 'local',
    rootPath: requiredString(object.rootPath, `${path}.rootPath`),
    displayName: requiredString(object.displayName, `${path}.displayName`),
    directoryName: requiredString(object.directoryName, `${path}.directoryName`),
    skillPaths: stringArray(object.skillPaths, `${path}.skillPaths`),
    importedSkillNames: stringArray(object.importedSkillNames, `${path}.importedSkillNames`),
    importedAt: finiteNumber(object.importedAt, `${path}.importedAt`),
    updatedAt: finiteNumber(object.updatedAt, `${path}.updatedAt`),
    warnings: stringArray(object.warnings, `${path}.warnings`),
    ...(object.lastCheckedAt === undefined
      ? {}
      : { lastCheckedAt: finiteNumber(object.lastCheckedAt, `${path}.lastCheckedAt`) }),
  } as LocalSkillSource;
}

function decodeRemoteSkillMetadata(value: unknown, path: string): RemoteSkillMetadata {
  const object = recordValue(value, path);
  const provider = enumValue(object.provider, IMPORTED_SKILL_PROVIDERS, `${path}.provider`);
  return {
    ...object,
    provider,
    sourceId: requiredString(object.sourceId, `${path}.sourceId`),
    path: requiredString(object.path, `${path}.path`),
    originalName: requiredString(object.originalName, `${path}.originalName`),
    importedAt: finiteNumber(object.importedAt, `${path}.importedAt`),
    updatedAt: finiteNumber(object.updatedAt, `${path}.updatedAt`),
    includedFiles: fileArray(object.includedFiles, `${path}.includedFiles`),
    omittedFiles: fileArray(object.omittedFiles, `${path}.omittedFiles`),
    warnings: stringArray(object.warnings, `${path}.warnings`),
    ...(object.sourceUrl === undefined ? {} : { sourceUrl: stringValue(object.sourceUrl, `${path}.sourceUrl`) }),
    ...(object.repository === undefined ? {} : { repository: stringValue(object.repository, `${path}.repository`) }),
    ...(object.ref === undefined ? {} : { ref: stringValue(object.ref, `${path}.ref`) }),
    ...(object.commitSha === undefined ? {} : { commitSha: stringValue(object.commitSha, `${path}.commitSha`) }),
    ...(object.lastCheckedAt === undefined ? {} : { lastCheckedAt: finiteNumber(object.lastCheckedAt, `${path}.lastCheckedAt`) }),
    ...(object.localRootPath === undefined ? {} : { localRootPath: stringValue(object.localRootPath, `${path}.localRootPath`) }),
    ...(object.localDirectory === undefined ? {} : { localDirectory: stringValue(object.localDirectory, `${path}.localDirectory`) }),
    ...(object.localDisplayName === undefined ? {} : { localDisplayName: stringValue(object.localDisplayName, `${path}.localDisplayName`) }),
    ...(object.licenseName === undefined ? {} : { licenseName: stringValue(object.licenseName, `${path}.licenseName`) }),
    ...(object.licenseSpdxId === undefined ? {} : { licenseSpdxId: stringValue(object.licenseSpdxId, `${path}.licenseSpdxId`) }),
    ...(object.upstreamVersion === undefined ? {} : { upstreamVersion: stringValue(object.upstreamVersion, `${path}.upstreamVersion`) }),
    ...(object.upstreamUpdatedAt === undefined ? {} : { upstreamUpdatedAt: stringValue(object.upstreamUpdatedAt, `${path}.upstreamUpdatedAt`) }),
    ...(object.scriptFiles === undefined ? {} : { scriptFiles: fileArray(object.scriptFiles, `${path}.scriptFiles`) }),
  } as RemoteSkillMetadata;
}

function fileArray(value: unknown, path: string): RemoteSkillFile[] {
  return arrayValue(value, path).map((item, index) => {
    const object = recordValue(item, `${path}[${index}]`);
    const bytes = finiteNumber(object.bytes, `${path}[${index}].bytes`);
    if (bytes < 0) throw new Error(`${path}[${index}].bytes must be non-negative`);
    return {
      ...object,
      path: requiredString(object.path, `${path}[${index}].path`),
      bytes,
    } as RemoteSkillFile;
  });
}

function releasedArray(value: unknown, path: string): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && 'schemaVersion' in value) {
    throw new Error(`${path}.schemaVersion is not supported`);
  }
  throw new Error(`${path} must use the released array schema`);
}

function recordValue(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new Error(`${path} must be a string`);
  return value;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean`);
  return value;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`);
  }
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  return arrayValue(value, path).map((item, index) => stringValue(item, `${path}[${index}]`));
}

function stringRecord(value: unknown, path: string): Record<string, string> {
  const object = recordValue(value, path);
  for (const [key, item] of Object.entries(object)) {
    if (typeof item !== 'string') throw new Error(`${path}.${key} must be a string`);
  }
  return { ...object } as Record<string, string>;
}

function enumValue<T extends string>(value: unknown, allowed: ReadonlySet<T>, path: string): T {
  if (typeof value !== 'string' || !allowed.has(value as T)) {
    throw new Error(`${path} is not supported`);
  }
  return value as T;
}

function assertOptionalSchemaVersion(
  value: unknown,
  currentVersion: number,
  path: string,
): void {
  if (value !== undefined && value !== currentVersion) {
    throw new Error(`${path}.schemaVersion is not supported`);
  }
}
