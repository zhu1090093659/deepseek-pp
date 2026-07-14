import {
  PROJECT_CONTEXT_SCHEMA_VERSION,
  type CurrentDeepSeekConversation,
  type ProjectContext,
  type ProjectContextState,
  type ProjectConversation,
} from './types';
import type { VersionedValueCodec } from '../persistence/versioned-repository';

const PROJECT_CONTEXT_LEGACY_SCHEMA_VERSION = 1;
const PROJECT_SOURCE_KINDS = new Set(['manual', 'local_folder', 'github', 'web_page']);

export const projectContextCodec: VersionedValueCodec<ProjectContextState> = {
  decode: decodeProjectContextState,
  encode(value) {
    return decodeProjectContextState(value, 'projectContext');
  },
};

export function createEmptyProjectContextState(): ProjectContextState {
  return {
    schemaVersion: PROJECT_CONTEXT_SCHEMA_VERSION,
    projects: [],
    conversations: [],
    pendingProjectId: null,
  };
}

export function decodeProjectContextState(
  value: unknown,
  path = 'projectContext',
): ProjectContextState {
  const object = recordValue(value, path);
  if (object.schemaVersion === PROJECT_CONTEXT_LEGACY_SCHEMA_VERSION) {
    return migrateProjectContextV1(object, path);
  }
  if (object.schemaVersion !== undefined && object.schemaVersion !== PROJECT_CONTEXT_SCHEMA_VERSION) {
    throw new Error(`${path}.schemaVersion is not supported`);
  }
  return decodeProjectContextV2(object, path);
}

export function decodeProjectContext(value: unknown, path = 'project'): ProjectContext {
  const object = recordValue(value, path);
  return {
    ...object,
    id: requiredString(object.id, `${path}.id`),
    name: requiredString(object.name, `${path}.name`),
    description: optionalString(object.description, `${path}.description`),
    instructions: optionalString(object.instructions, `${path}.instructions`),
    createdAt: finiteNumber(object.createdAt, `${path}.createdAt`),
    updatedAt: finiteNumber(object.updatedAt, `${path}.updatedAt`),
  } as ProjectContext;
}

export function decodeProjectConversation(
  value: unknown,
  path = 'projectConversation',
): ProjectConversation {
  const object = recordValue(value, path);
  return {
    ...object,
    conversationId: requiredString(object.conversationId, `${path}.conversationId`),
    projectId: requiredString(object.projectId, `${path}.projectId`),
    title: requiredString(object.title, `${path}.title`),
    url: optionalString(object.url, `${path}.url`),
    addedAt: finiteNumber(object.addedAt, `${path}.addedAt`),
    lastSeenAt: finiteNumber(object.lastSeenAt, `${path}.lastSeenAt`),
  } as ProjectConversation;
}

export function decodeCurrentDeepSeekConversation(
  value: unknown,
  path = 'currentDeepSeekConversation',
): CurrentDeepSeekConversation {
  const object = recordValue(value, path);
  return {
    ...object,
    conversationId: requiredString(object.conversationId, `${path}.conversationId`),
    title: requiredString(object.title, `${path}.title`),
    url: requiredString(object.url, `${path}.url`),
  } as CurrentDeepSeekConversation;
}

export function removeProjectFromLegacyFields(
  state: ProjectContextState,
  projectId: string,
): ProjectContextState {
  const object = state as unknown as Record<string, unknown>;
  if (!Array.isArray(object.files)) return state;

  const remainingFiles = object.files.filter((value) => {
    const file = value as Record<string, unknown>;
    return file.projectId !== projectId;
  });
  const remainingFileIds = new Set(remainingFiles.map((value) => (
    (value as Record<string, unknown>).id
  )).filter((id): id is string => typeof id === 'string'));

  return {
    ...state,
    files: remainingFiles,
    ...(object.activeProjectId === projectId ? { activeProjectId: null } : {}),
    ...(Array.isArray(object.activeFileIds)
      ? {
          activeFileIds: object.activeFileIds.filter((id): id is string => (
            typeof id === 'string' && remainingFileIds.has(id)
          )),
        }
      : {}),
  } as ProjectContextState;
}

function decodeProjectContextV2(
  object: Record<string, unknown>,
  path: string,
): ProjectContextState {
  const projects = arrayValue(object.projects, `${path}.projects`)
    .map((item, index) => decodeProjectContext(item, `${path}.projects[${index}]`));
  assertUniqueIds(projects.map((project) => project.id), `${path}.projects`, 'project');
  const projectIds = new Set(projects.map((project) => project.id));
  const conversations = arrayValue(object.conversations, `${path}.conversations`)
    .map((item, index) => decodeProjectConversation(item, `${path}.conversations[${index}]`));
  const conversationIds = new Set<string>();

  for (const conversation of conversations) {
    if (!projectIds.has(conversation.projectId)) {
      throw new Error(`${path}.conversations contains conversation for unknown project: ${conversation.projectId}`);
    }
    if (conversationIds.has(conversation.conversationId)) {
      throw new Error(`${path}.conversations contains duplicate conversation: ${conversation.conversationId}`);
    }
    conversationIds.add(conversation.conversationId);
  }

  const pendingProjectId = object.pendingProjectId === null
    ? null
    : requiredString(object.pendingProjectId, `${path}.pendingProjectId`);
  if (pendingProjectId !== null && !projectIds.has(pendingProjectId)) {
    throw new Error(`${path}.pendingProjectId references an unknown project`);
  }

  return {
    ...object,
    schemaVersion: PROJECT_CONTEXT_SCHEMA_VERSION,
    projects,
    conversations,
    pendingProjectId,
  } as ProjectContextState;
}

function migrateProjectContextV1(
  object: Record<string, unknown>,
  path: string,
): ProjectContextState {
  const projects = arrayValue(object.projects, `${path}.projects`)
    .map((item, index) => decodeProjectContextV1Project(item, `${path}.projects[${index}]`));
  assertUniqueIds(projects.map((project) => project.id), `${path}.projects`, 'project');
  const projectIds = new Set(projects.map((project) => project.id));
  const files = arrayValue(object.files, `${path}.files`)
    .map((item, index) => decodeProjectContextV1File(item, `${path}.files[${index}]`));
  assertUniqueIds(files.map((file) => file.id), `${path}.files`, 'file');
  const fileIds = new Set(files.map((file) => file.id));

  for (const file of files) {
    if (!projectIds.has(file.projectId)) {
      throw new Error(`${path}.files contains file for unknown project: ${file.projectId}`);
    }
  }

  const activeProjectId = object.activeProjectId === null
    ? null
    : requiredString(object.activeProjectId, `${path}.activeProjectId`);
  if (activeProjectId !== null && !projectIds.has(activeProjectId)) {
    throw new Error(`${path}.activeProjectId references an unknown project`);
  }
  const activeFileIds = stringArray(object.activeFileIds, `${path}.activeFileIds`);
  for (const fileId of activeFileIds) {
    if (!fileIds.has(fileId)) {
      throw new Error(`${path}.activeFileIds references an unknown file: ${fileId}`);
    }
  }

  // v1's active project is not v2's pending-next-conversation project. Keep
  // every v1 field as an additive sibling and add only the v2 projections.
  return {
    ...object,
    schemaVersion: PROJECT_CONTEXT_SCHEMA_VERSION,
    projects,
    files,
    activeProjectId,
    activeFileIds,
    conversations: [],
    pendingProjectId: null,
  } as ProjectContextState;
}

function decodeProjectContextV1Project(value: unknown, path: string): ProjectContext {
  const project = decodeProjectContext(value, path) as ProjectContext & Record<string, unknown>;
  const source = recordValue(project.source, `${path}.source`);
  const kind = requiredString(source.kind, `${path}.source.kind`);
  if (!PROJECT_SOURCE_KINDS.has(kind)) throw new Error(`${path}.source.kind is not supported`);
  const decodedSource = {
    ...source,
    kind,
    label: requiredString(source.label, `${path}.source.label`),
    ...(source.url === undefined ? {} : { url: stringValue(source.url, `${path}.source.url`) }),
    ...(source.owner === undefined ? {} : { owner: stringValue(source.owner, `${path}.source.owner`) }),
    ...(source.repo === undefined ? {} : { repo: stringValue(source.repo, `${path}.source.repo`) }),
    ...(source.ref === undefined ? {} : { ref: stringValue(source.ref, `${path}.source.ref`) }),
    importedAt: finiteNumber(source.importedAt, `${path}.source.importedAt`),
  };
  return { ...project, source: decodedSource } as ProjectContext;
}

function decodeProjectContextV1File(value: unknown, path: string) {
  const object = recordValue(value, path);
  const sourceKind = requiredString(object.sourceKind, `${path}.sourceKind`);
  if (!PROJECT_SOURCE_KINDS.has(sourceKind)) throw new Error(`${path}.sourceKind is not supported`);
  return {
    ...object,
    id: requiredString(object.id, `${path}.id`),
    projectId: requiredString(object.projectId, `${path}.projectId`),
    path: requiredString(object.path, `${path}.path`),
    content: stringValue(object.content, `${path}.content`),
    sizeBytes: finiteNumber(object.sizeBytes, `${path}.sizeBytes`),
    sourceKind,
    createdAt: finiteNumber(object.createdAt, `${path}.createdAt`),
  };
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

function optionalString(value: unknown, path: string): string {
  if (value === undefined) return '';
  return stringValue(value, path);
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

function assertUniqueIds(ids: readonly string[], path: string, label: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`${path} contains duplicate ${label}: ${id}`);
    seen.add(id);
  }
}
