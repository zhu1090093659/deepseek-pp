import type { SystemPromptPreset } from '../types';
import type { VersionedValueCodec } from '../persistence/versioned-repository';

export const PRESET_RECORD_SCHEMA_VERSION = 1 as const;

export const presetCollectionCodec: VersionedValueCodec<SystemPromptPreset[]> = {
  decode: decodePresetCollection,
  encode(value) {
    return decodePresetCollection(value, 'presets');
  },
};

export function decodePresetCollection(
  value: unknown,
  path = 'presets',
): SystemPromptPreset[] {
  return releasedArray(value, path)
    .map((item, index) => decodePreset(item, `${path}[${index}]`));
}

export function decodePreset(value: unknown, path = 'preset'): SystemPromptPreset {
  const object = recordValue(value, path);
  if (object.schemaVersion !== undefined && object.schemaVersion !== PRESET_RECORD_SCHEMA_VERSION) {
    throw new Error(`${path}.schemaVersion is not supported`);
  }
  return {
    ...object,
    id: requiredString(object.id, `${path}.id`),
    name: stringValue(object.name, `${path}.name`),
    content: stringValue(object.content, `${path}.content`),
    createdAt: finiteNumber(object.createdAt, `${path}.createdAt`),
    updatedAt: finiteNumber(object.updatedAt, `${path}.updatedAt`),
  } as SystemPromptPreset;
}

export function decodeActivePresetId(value: unknown, path = 'activePresetId'): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value) && 'schemaVersion' in value) {
    throw new Error(`${path}.schemaVersion is not supported`);
  }
  throw new Error(`${path} must use the released string schema`);
}

export function decodeActivePreset(
  value: unknown,
  path = 'activePreset',
): SystemPromptPreset | null {
  return value === null ? null : decodePreset(value, path);
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

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`);
  }
  return value;
}
