import { describe, expect, it, vi } from 'vitest';
import type { InlineAgentTraceRecord } from '../core/inline-agent/types';
import { decodeInlineAgentTraces } from '../core/inline-agent/trace-codec';
import { createInlineAgentTraceStore } from '../core/inline-agent/trace-store';
import type { RawStorageSlot, StorageSlotPort } from '../core/persistence/versioned-repository';
import { decodeToolExecutionBlocks } from '../core/tool/execution-block-codec';
import { createToolExecutionBlockStore } from '../core/tool/execution-block-store';
import {
  CONTRACT_EXECUTION_RECORD,
  CONTRACT_RESTORE_RECORD,
} from './fixtures/runtime-contract/tool-records';

describe('Content persistence codecs', () => {
  it('preserves released versionless tool-block arrays and additive fields', () => {
    const raw = [{
      ...CONTRACT_RESTORE_RECORD,
      additiveRoot: { retained: true },
    }];

    const decoded = decodeToolExecutionBlocks(structuredClone(raw));

    expect(decoded).toEqual(raw);
    expect((decoded[0] as unknown as Record<string, unknown>).additiveRoot).toEqual({ retained: true });
  });

  it('preserves released versionless inline traces and additive fields', () => {
    const raw = [createTrace({ additiveRoot: 'retained' })];

    const decoded = decodeInlineAgentTraces(structuredClone(raw));

    expect(decoded).toEqual(raw);
    expect((decoded[0] as unknown as Record<string, unknown>).additiveRoot).toBe('retained');
  });

  it('accepts released inline traces that predate finalText storage', () => {
    const legacy = createTrace({ finalText: undefined });

    const [decoded] = decodeInlineAgentTraces([legacy]);

    expect(decoded.finalText).toBeUndefined();
  });

  it('rejects corrupt or unsupported future roots instead of filtering them', () => {
    expect(() => decodeToolExecutionBlocks({ schemaVersion: 2, items: [] }))
      .toThrow('must be a versionless array');
    expect(() => decodeToolExecutionBlocks([{ ...CONTRACT_RESTORE_RECORD, executions: [{}] }]))
      .toThrow('not a valid tool restore record');
    expect(() => decodeInlineAgentTraces({ schemaVersion: 2, items: [] }))
      .toThrow('must be a versionless array');
    expect(() => decodeInlineAgentTraces([createTrace({ status: 'future_status' })]))
      .toThrow('status is not supported');
  });

  it('does not overwrite corrupt tool-block state during an upsert', async () => {
    const storage = createMemorySlot({ present: true, value: [{ id: 'corrupt' }] });
    const store = createToolExecutionBlockStore(storage);

    await expect(store.upsert(structuredClone(CONTRACT_RESTORE_RECORD)))
      .rejects.toThrow('toolExecutionBlocks[0]');
    expect(storage.write).not.toHaveBeenCalled();
  });

  it('does not overwrite corrupt inline trace state during an upsert', async () => {
    const storage = createMemorySlot({
      present: true,
      value: [createTrace({ steps: [{ index: 0, status: 'complete' }] })],
    });
    const store = createInlineAgentTraceStore(storage);

    await expect(store.upsert(createTrace())).rejects.toThrow('inlineAgentTraces[0].steps[0]');
    expect(storage.write).not.toHaveBeenCalled();
  });

  it('surfaces read and write failures to the controller boundary', async () => {
    const readFailure = new Error('storage read failed');
    const readStorage: StorageSlotPort = {
      read: vi.fn(async () => { throw readFailure; }),
      write: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
    await expect(createToolExecutionBlockStore(readStorage).read()).rejects.toBe(readFailure);

    const writeFailure = new Error('storage write failed');
    const writeStorage = createMemorySlot({ present: true, value: [] });
    writeStorage.write.mockRejectedValueOnce(writeFailure);
    await expect(createInlineAgentTraceStore(writeStorage).upsert(createTrace()))
      .rejects.toBe(writeFailure);
  });
});

function createTrace(overrides: Record<string, unknown> = {}): InlineAgentTraceRecord {
  return {
    id: 'trace-contract-1',
    loopId: 'loop-contract-1',
    chatSessionId: 'chat-contract-1',
    anchorMessageId: 10,
    anchorMessageIndex: 0,
    anchorContent: 'Anchor',
    url: 'https://chat.deepseek.com/a/chat/s/chat-contract-1',
    originalPrompt: 'Use the browser tool.',
    agentTaskPrompt: 'Continue until complete.',
    status: 'complete',
    steps: [{
      index: 0,
      status: 'complete',
      text: 'Done',
      toolExecutions: [structuredClone(CONTRACT_EXECUTION_RECORD)],
      responseMessageId: 11,
      collapsed: true,
      additiveStep: 'retained',
    }],
    totalSteps: 1,
    totalTools: 1,
    finalText: 'Done',
    createdAt: 1_752_384_000_000,
    updatedAt: 1_752_384_000_100,
    ...overrides,
  } as unknown as InlineAgentTraceRecord;
}

function createMemorySlot(initial: RawStorageSlot): StorageSlotPort & {
  write: ReturnType<typeof vi.fn>;
} {
  let slot = initial;
  const write = vi.fn(async (value: unknown) => {
    slot = { present: true, value };
  });
  return {
    read: vi.fn(async () => slot),
    write,
    remove: vi.fn(async () => {
      slot = { present: false };
    }),
  };
}
