import {
  definePayloadlessRuntimeCommandHandler,
  type RuntimeCommandHandler,
} from '../../core/messaging/runtime-command-registry';
import type { Memory, NewMemory } from '../../core/types';
import { definePersistencePayloadRuntimeCommandHandler } from './runtime-handler';

export interface MemoryRuntimeHandlerDependencies {
  getAllMemories(): Promise<Memory[]>;
  getMemoryById(id: number): Promise<Memory | undefined>;
  saveMemory(memory: NewMemory): Promise<number>;
  importMemoriesAtomically(memories: readonly NewMemory[]): Promise<number[]>;
  updateMemory(memory: Memory): Promise<void>;
  deleteMemory(id: number): Promise<void>;
  touchMemories(ids: number[]): Promise<void>;
  notifyCommittedStateUpdate(excludeTabId?: number): Promise<void>;
}

export function createMemoryRuntimeHandlers(
  dependencies: MemoryRuntimeHandlerDependencies,
): readonly RuntimeCommandHandler[] {
  return Object.freeze([
    definePayloadlessRuntimeCommandHandler('GET_MEMORIES', () => (
      dependencies.getAllMemories()
    )),
    definePersistencePayloadRuntimeCommandHandler('GET_MEMORY_BY_ID', async (payload) => {
      return (await dependencies.getMemoryById(payload.id)) ?? null;
    }),
    definePersistencePayloadRuntimeCommandHandler('SAVE_MEMORY', async (memory, context) => {
      const id = await dependencies.saveMemory(memory);
      await dependencies.notifyCommittedStateUpdate(context.tabId);
      return { id };
    }),
    definePersistencePayloadRuntimeCommandHandler('IMPORT_MEMORY_DRAFTS', async (payload, context) => {
      if (!Array.isArray(payload.memories)) {
        return { ok: false as const, error: 'invalid_memories' };
      }

      let ids: number[];
      try {
        ids = await dependencies.importMemoriesAtomically(payload.memories);
      } catch (error) {
        return {
          ok: false as const,
          error: error instanceof Error ? error.message : 'invalid_memories',
        };
      }
      await dependencies.notifyCommittedStateUpdate(context.tabId);
      return { ok: true as const, ids, count: ids.length };
    }),
    definePersistencePayloadRuntimeCommandHandler('UPDATE_MEMORY', async (memory, context) => {
      await dependencies.updateMemory(memory);
      await dependencies.notifyCommittedStateUpdate(context.tabId);
      return { ok: true as const };
    }),
    definePersistencePayloadRuntimeCommandHandler('DELETE_MEMORY', async (payload, context) => {
      await dependencies.deleteMemory(payload.id);
      await dependencies.notifyCommittedStateUpdate(context.tabId);
      return { ok: true as const };
    }),
    definePersistencePayloadRuntimeCommandHandler('TOUCH_MEMORIES', async (payload) => {
      await dependencies.touchMemories(payload.ids);
      return { ok: true as const };
    }),
  ]);
}
