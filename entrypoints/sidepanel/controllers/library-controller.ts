import { decodePersistedMemoryRecord } from '../../../core/memory/codec';
import { decodeSavedItem, decodeSavedItemsState } from '../../../core/saved-items/codec';
import type { SavedItem, SavedItemInput } from '../../../core/saved-items/types';
import type { Memory, NewMemory } from '../../../core/types';
import {
  sidepanelRuntimeClient,
  type SidepanelRuntimeClient,
} from '../runtime-client';

export interface LibraryController {
  getMemories(): Promise<Memory[]>;
  saveMemory(memory: NewMemory): Promise<number>;
  updateMemory(memory: Memory): Promise<void>;
  deleteMemory(id: number): Promise<void>;
  getSavedItems(): Promise<SavedItem[]>;
  saveSavedItem(item: SavedItemInput): Promise<SavedItem>;
  deleteSavedItem(id: string): Promise<void>;
  insertSavedPrompt(text: string): Promise<void>;
}

export function decodeMemoryList(value: unknown, path: string): Memory[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value.map((memory, index) => (
    decodePersistedMemoryRecord(memory, `${path}[${index}]`)
  ));
}

export function decodeSavedItemList(value: unknown, path: string): SavedItem[] {
  return decodeSavedItemsState(value, path).items;
}

export function createLibraryController(
  runtimeClient: SidepanelRuntimeClient = sidepanelRuntimeClient,
): LibraryController {
  const controller: LibraryController = {
    getMemories: () => runtimeClient.request(
      { type: 'GET_MEMORIES' },
      { decode: (value) => decodeMemoryList(value, 'GET_MEMORIES response') },
    ),
    async saveMemory(memory) {
      return runtimeClient.request(
        { type: 'SAVE_MEMORY', payload: memory },
        {
          decode(value) {
            const record = requireRecord(value, 'SAVE_MEMORY response');
            if (!Number.isSafeInteger(record.id)) {
              throw new Error('SAVE_MEMORY response.id must be an integer.');
            }
            return record.id as number;
          },
        },
      );
    },
    async updateMemory(memory) {
      await runtimeClient.request(
        { type: 'UPDATE_MEMORY', payload: memory },
        { decode: decodeAck },
      );
    },
    async deleteMemory(id) {
      await runtimeClient.request(
        { type: 'DELETE_MEMORY', payload: { id } },
        { decode: decodeAck },
      );
    },
    getSavedItems: () => runtimeClient.request(
      { type: 'GET_SAVED_ITEMS' },
      { decode: (value) => decodeSavedItemList(value, 'GET_SAVED_ITEMS response') },
    ),
    saveSavedItem: (item) => runtimeClient.request(
      { type: 'SAVE_SAVED_ITEM', payload: item },
      { decode: (value) => decodeSavedItem(value, 'SAVE_SAVED_ITEM response') },
    ),
    async deleteSavedItem(id) {
      await runtimeClient.request(
        { type: 'DELETE_SAVED_ITEM', payload: { id } },
        { decode: decodeAck },
      );
    },
    async insertSavedPrompt(text) {
      await runtimeClient.request(
        { type: 'INSERT_SAVED_PROMPT_INTO_CHAT', payload: { text } },
        { decode: decodeAck },
      );
    },
  };
  return Object.freeze(controller);
}

export const libraryController = createLibraryController();

function decodeAck(value: unknown): void {
  const record = requireRecord(value, 'runtime acknowledgement');
  if (record.ok !== true) throw new Error('Invalid runtime acknowledgement.');
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}
