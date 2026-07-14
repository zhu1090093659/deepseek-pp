import {
  SAVED_ITEMS_SCHEMA_VERSION,
  type SavedItem,
  type SavedItemInput,
  type SavedItemsState,
} from './types';
import { withSyncLocalStateLock } from '../persistence/local-state-lock';
import {
  createChromeStorageSlot,
  createVersionedRepository,
} from '../persistence/versioned-repository';
import { createEmptySavedItemsState, savedItemsCodec } from './codec';

export const SAVED_ITEMS_STORAGE_KEY = 'deepseek_pp_saved_items';

const savedItemsRepository = createVersionedRepository({
  label: 'savedItems',
  createDefault: createEmptySavedItemsState,
  codec: savedItemsCodec,
  storage: createChromeStorageSlot(SAVED_ITEMS_STORAGE_KEY),
});

export async function getSavedItemsState(): Promise<SavedItemsState> {
  return savedItemsRepository.read();
}

export async function getSavedItemsStateAlreadyLocked(): Promise<SavedItemsState> {
  return savedItemsRepository.readAlreadyLocked();
}

export async function getAllSavedItems(): Promise<SavedItem[]> {
  return (await getSavedItemsState()).items;
}

export async function saveSavedItem(input: SavedItemInput): Promise<SavedItem> {
  return withSyncLocalStateLock(async () => {
    const state = await savedItemsRepository.readAlreadyLocked();
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
    await writeSavedItems(state, nextItems);
    return item;
  });
}

export async function deleteSavedItem(id: string): Promise<void> {
  await withSyncLocalStateLock(async () => {
    const state = await savedItemsRepository.readAlreadyLocked();
    await writeSavedItems(state, state.items.filter((item) => item.id !== id));
  });
}

export async function replaceSavedItemsStateForSyncApply(state: SavedItemsState): Promise<void> {
  await savedItemsRepository.replaceAlreadyLocked(state);
}

async function writeSavedItems(state: SavedItemsState, items: SavedItem[]): Promise<void> {
  await savedItemsRepository.writeAfterReadAlreadyLocked({
    ...state,
    schemaVersion: SAVED_ITEMS_SCHEMA_VERSION,
    items,
  });
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Saved item ${field} must be a non-empty string`);
  }
  return value.trim();
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
