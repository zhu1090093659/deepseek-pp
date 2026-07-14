import type { Memory, MemoryType, NewMemory } from '../types';

const MEMORY_TYPES: readonly MemoryType[] = ['user', 'feedback', 'topic', 'reference'];

export function decodePersistedMemoryRecord(
  value: unknown,
  path = 'memory',
): Memory {
  const object = objectValue(value, path);
  const id = positiveSafeInteger(object.id, `${path}.id`);
  return {
    ...decodeStoredMemory(object, path),
    id,
  };
}

export function decodeStoredMemory(
  value: unknown,
  path = 'memory',
): Omit<Memory, 'id'> {
  const object = objectValue(value, path);
  const scope = memoryScope(object.scope, `${path}.scope`);
  const { id: _id, projectId: _projectId, ...additiveFields } = object;
  return {
    ...additiveFields,
    syncId: nonEmptyString(object.syncId, `${path}.syncId`),
    scope,
    ...(scope === 'project'
      ? { projectId: nonEmptyString(object.projectId, `${path}.projectId`) }
      : {}),
    type: enumValue(object.type, MEMORY_TYPES, `${path}.type`),
    name: nonEmptyString(object.name, `${path}.name`),
    content: nonEmptyString(object.content, `${path}.content`),
    description: stringValue(object.description, `${path}.description`),
    tags: stringArray(object.tags, `${path}.tags`),
    pinned: booleanValue(object.pinned, `${path}.pinned`),
    createdAt: finiteNumber(object.createdAt, `${path}.createdAt`),
    updatedAt: finiteNumber(object.updatedAt, `${path}.updatedAt`),
    accessCount: finiteNumber(object.accessCount, `${path}.accessCount`),
    lastAccessedAt: finiteNumber(object.lastAccessedAt, `${path}.lastAccessedAt`),
  } as Omit<Memory, 'id'>;
}

export function decodeSyncMemory(
  value: unknown,
  path = 'memory',
): Omit<Memory, 'id'> {
  const object = objectValue(value, path);
  const { id: _id, ...memory } = object;
  return decodeStoredMemory({
    ...memory,
    scope: memory.scope ?? 'global',
  }, path);
}

export function decodeImportedMemory(
  value: unknown,
  path = 'memory',
): NewMemory {
  const object = objectValue(value, path);
  const scope = object.scope === undefined
    ? 'global'
    : memoryScope(object.scope, `${path}.scope`);
  return {
    syncId: object.syncId === undefined
      ? undefined
      : nonEmptyString(object.syncId, `${path}.syncId`),
    scope,
    projectId: scope === 'project'
      ? nonEmptyString(object.projectId, `${path}.projectId`)
      : undefined,
    type: enumValue(object.type, MEMORY_TYPES, `${path}.type`),
    name: nonEmptyString(object.name, `${path}.name`),
    content: nonEmptyString(object.content, `${path}.content`),
    description: stringValue(object.description, `${path}.description`),
    tags: stringArray(object.tags, `${path}.tags`),
    pinned: booleanValue(object.pinned, `${path}.pinned`),
  };
}

function objectValue(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function memoryScope(value: unknown, path: string): Memory['scope'] {
  if (value === 'global' || value === 'project') return value;
  throw new Error(`${path} must be global or project`);
}

function nonEmptyString(value: unknown, path: string): string {
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

function positiveSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${path} must be a positive safe integer`);
  }
  return value as number;
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${path} must be a string array`);
  }
  return [...value];
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${path} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}
