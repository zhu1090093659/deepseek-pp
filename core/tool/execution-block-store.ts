import { withSyncLocalStateLock } from '../persistence/local-state-lock';
import {
  createChromeStorageSlot,
  createVersionedRepository,
  type StorageSlotPort,
} from '../persistence/versioned-repository';
import {
  toolExecutionBlockCodec,
  type PersistedToolExecutionBlock,
} from './execution-block-codec';

export const TOOL_EXECUTION_BLOCKS_STORAGE_KEY = 'dpp_tool_execution_blocks';
export const TOOL_EXECUTION_BLOCK_LIMIT = 100;
export const TOOL_EXECUTION_BLOCK_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export interface ToolExecutionBlockStore {
  read(): Promise<PersistedToolExecutionBlock[]>;
  upsert(block: PersistedToolExecutionBlock, now?: number): Promise<void>;
}

export function createToolExecutionBlockStore(
  storage: StorageSlotPort = createChromeStorageSlot(TOOL_EXECUTION_BLOCKS_STORAGE_KEY),
): ToolExecutionBlockStore {
  const repository = createVersionedRepository({
    label: 'toolExecutionBlocks',
    createDefault: () => [],
    codec: toolExecutionBlockCodec,
    storage,
  });

  return {
    read: () => repository.read(),
    async upsert(block, now = Date.now()) {
      await withSyncLocalStateLock(async () => {
        const decoded = toolExecutionBlockCodec.decode([block], 'toolExecutionBlocks.upsert')[0];
        const current = await repository.readAlreadyLocked();
        const next = [
          ...current.filter((item) => item.id !== decoded.id),
          decoded,
        ]
          .filter((item) => now - item.createdAt < TOOL_EXECUTION_BLOCK_TTL_MS)
          .slice(-TOOL_EXECUTION_BLOCK_LIMIT);
        await repository.writeAfterReadAlreadyLocked(next);
      });
    },
  };
}

const toolExecutionBlockStore = createToolExecutionBlockStore();

export function readPersistedToolExecutionBlocks(): Promise<PersistedToolExecutionBlock[]> {
  return toolExecutionBlockStore.read();
}

export function upsertPersistedToolExecutionBlock(
  block: PersistedToolExecutionBlock,
  now?: number,
): Promise<void> {
  return toolExecutionBlockStore.upsert(block, now);
}
