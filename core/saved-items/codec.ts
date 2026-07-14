import {
  SAVED_ITEMS_SCHEMA_VERSION,
  type SavedItem,
  type SavedItemKind,
  type SavedItemsState,
} from './types';
import type { VersionedValueCodec } from '../persistence/versioned-repository';

const SAVED_ITEM_KINDS = new Set<SavedItemKind>(['snippet', 'bookmark']);

export const savedItemsCodec: VersionedValueCodec<SavedItemsState> = {
  decode: decodeSavedItemsState,
  encode(value) {
    return decodeSavedItemsState(value, 'savedItems');
  },
};

export function createEmptySavedItemsState(): SavedItemsState {
  return { schemaVersion: SAVED_ITEMS_SCHEMA_VERSION, items: [] };
}

export function decodeSavedItemsState(value: unknown, path = 'savedItems'): SavedItemsState {
  if (Array.isArray(value)) {
    return {
      schemaVersion: SAVED_ITEMS_SCHEMA_VERSION,
      items: value.map((item, index) => decodeSavedItem(item, `${path}[${index}]`)),
    };
  }

  const object = recordValue(value, path);
  if (object.schemaVersion !== undefined && object.schemaVersion !== SAVED_ITEMS_SCHEMA_VERSION) {
    throw new Error(`${path}.schemaVersion is not supported`);
  }
  return {
    ...object,
    schemaVersion: SAVED_ITEMS_SCHEMA_VERSION,
    items: arrayValue(object.items, `${path}.items`)
      .map((item, index) => decodeSavedItem(item, `${path}.items[${index}]`)),
  } as SavedItemsState;
}

export function decodeSavedItem(value: unknown, path = 'savedItem'): SavedItem {
  const object = recordValue(value, path);
  const kind = requiredString(object.kind, `${path}.kind`);
  if (!SAVED_ITEM_KINDS.has(kind as SavedItemKind)) {
    throw new Error(`${path}.kind is not supported`);
  }
  return {
    ...object,
    id: requiredString(object.id, `${path}.id`),
    syncId: requiredString(object.syncId, `${path}.syncId`),
    kind: kind as SavedItemKind,
    title: requiredString(object.title, `${path}.title`),
    content: requiredString(object.content, `${path}.content`),
    ...(object.sourceUrl === undefined
      ? {}
      : { sourceUrl: requiredString(object.sourceUrl, `${path}.sourceUrl`) }),
    tags: stringArray(object.tags, `${path}.tags`),
    createdAt: finiteNumber(object.createdAt, `${path}.createdAt`),
    updatedAt: finiteNumber(object.updatedAt, `${path}.updatedAt`),
  } as SavedItem;
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

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`);
  }
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  return arrayValue(value, path).map((item, index) => {
    if (typeof item !== 'string') throw new Error(`${path}[${index}] must be a string`);
    return item;
  });
}
