import {
  SAVED_ITEMS_SCHEMA_VERSION,
  type SavedItem,
  type SavedItemInput,
  type SavedItemsState,
} from './types';
import { withSyncLocalStateLock } from '../persistence/local-state-lock';

export const SAVED_ITEMS_STORAGE_KEY = 'deepseek_pp_saved_items';

export async function getSavedItemsState(): Promise<SavedItemsState> {
  const data = await chrome.storage.local.get(SAVED_ITEMS_STORAGE_KEY) as Record<string, unknown>;
  return normalizeSavedItemsState(data[SAVED_ITEMS_STORAGE_KEY]);
}

export async function getAllSavedItems(): Promise<SavedItem[]> {
  return (await getSavedItemsState()).items;
}

export async function saveSavedItem(input: SavedItemInput): Promise<SavedItem> {
  return withSyncLocalStateLock(async () => {
    const state = await getSavedItemsState();
    const now = Date.now();
    const item: SavedItem = {
      id: input.id ?? createId(),
      syncId: input.syncId ?? createId(),
      kind: input.kind === 'bookmark' ? 'bookmark' : 'snippet',
      title: requireNonEmptyString(input.title, 'title'),
      content: requireNonEmptyString(input.content, 'content'),
      ...(input.sourceUrl && input.sourceUrl.trim() ? { sourceUrl: input.sourceUrl.trim() } : {}),
      tags: normalizeTags(input.tags),
      createdAt: input.createdAt ?? now,
      updatedAt: now,
    };
    const nextItems = [
      ...state.items.filter((existing) => existing.id !== item.id),
      item,
    ].sort((a, b) => b.updatedAt - a.updatedAt);
    await writeSavedItems(nextItems);
    return item;
  });
}

export async function deleteSavedItem(id: string): Promise<void> {
  await withSyncLocalStateLock(async () => {
    const state = await getSavedItemsState();
    await writeSavedItems(state.items.filter((item) => item.id !== id));
  });
}

export async function replaceAllSavedItems(items: SavedItem[]): Promise<void> {
  await withSyncLocalStateLock(() => replaceAllSavedItemsForSyncApply(items));
}

export async function replaceAllSavedItemsForSyncApply(items: SavedItem[]): Promise<void> {
  await writeSavedItems(items.map(normalizeSavedItem));
}

async function writeSavedItems(items: SavedItem[]): Promise<void> {
  await chrome.storage.local.set({
    [SAVED_ITEMS_STORAGE_KEY]: {
      schemaVersion: SAVED_ITEMS_SCHEMA_VERSION,
      items,
    } satisfies SavedItemsState,
  });
}

export function normalizeSavedItemsState(value: unknown): SavedItemsState {
  if (Array.isArray(value)) {
    return {
      schemaVersion: SAVED_ITEMS_SCHEMA_VERSION,
      items: value.map(normalizeSavedItem),
    };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      schemaVersion: SAVED_ITEMS_SCHEMA_VERSION,
      items: [],
    };
  }
  const object = value as Partial<SavedItemsState>;
  return {
    schemaVersion: SAVED_ITEMS_SCHEMA_VERSION,
    items: Array.isArray(object.items) ? object.items.map(normalizeSavedItem) : [],
  };
}

export function normalizeSavedItem(value: unknown): SavedItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Saved item must be an object');
  }
  const item = value as Partial<SavedItem>;
  return {
    id: requireNonEmptyString(item.id, 'id'),
    syncId: requireNonEmptyString(item.syncId, 'syncId'),
    kind: item.kind === 'bookmark' ? 'bookmark' : 'snippet',
    title: requireNonEmptyString(item.title, 'title'),
    content: requireNonEmptyString(item.content, 'content'),
    ...(item.sourceUrl && item.sourceUrl.trim() ? { sourceUrl: item.sourceUrl.trim() } : {}),
    tags: normalizeTags(item.tags),
    createdAt: finiteNumber(item.createdAt, 'createdAt'),
    updatedAt: finiteNumber(item.updatedAt, 'updatedAt'),
  };
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Saved item ${field} must be a non-empty string`);
  }
  return value.trim();
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Saved item ${field} must be a finite number`);
  }
  return value;
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter(Boolean))];
}

function createId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `saved-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
