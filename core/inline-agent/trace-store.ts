import { withSyncLocalStateLock } from '../persistence/local-state-lock';
import {
  createChromeStorageSlot,
  createVersionedRepository,
  type StorageSlotPort,
} from '../persistence/versioned-repository';
import type { InlineAgentTraceRecord } from './types';
import { inlineAgentTraceCodec } from './trace-codec';

export const INLINE_AGENT_TRACES_STORAGE_KEY = 'dpp_inline_agent_traces';
export const INLINE_AGENT_TRACE_LIMIT = 100;
export const INLINE_AGENT_TRACE_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export interface InlineAgentTraceStore {
  read(): Promise<InlineAgentTraceRecord[]>;
  upsert(trace: InlineAgentTraceRecord, now?: number): Promise<void>;
}

export function createInlineAgentTraceStore(
  storage: StorageSlotPort = createChromeStorageSlot(INLINE_AGENT_TRACES_STORAGE_KEY),
): InlineAgentTraceStore {
  const repository = createVersionedRepository({
    label: 'inlineAgentTraces',
    createDefault: () => [],
    codec: inlineAgentTraceCodec,
    storage,
  });

  return {
    read: () => repository.read(),
    async upsert(trace, now = Date.now()) {
      await withSyncLocalStateLock(async () => {
        const decoded = inlineAgentTraceCodec.decode([trace], 'inlineAgentTraces.upsert')[0];
        const current = await repository.readAlreadyLocked();
        const next = [
          ...current.filter((item) => item.id !== decoded.id),
          decoded,
        ]
          .filter((item) => now - item.createdAt < INLINE_AGENT_TRACE_TTL_MS)
          .slice(-INLINE_AGENT_TRACE_LIMIT);
        await repository.writeAfterReadAlreadyLocked(next);
      });
    },
  };
}

const inlineAgentTraceStore = createInlineAgentTraceStore();

export function readPersistedInlineAgentTraces(): Promise<InlineAgentTraceRecord[]> {
  return inlineAgentTraceStore.read();
}

export function upsertPersistedInlineAgentTrace(
  trace: InlineAgentTraceRecord,
  now?: number,
): Promise<void> {
  return inlineAgentTraceStore.upsert(trace, now);
}
