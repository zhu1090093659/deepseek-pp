import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeRuntimeToolCall } from '../core/tool/runtime';
import { getArtifact } from '../core/artifact';
import {
  appendExternalizedToolPayloadChunk,
  chainExternalizedPayloadWrite,
  createExternalizedToolPayload,
} from '../core/tool/externalized-payload';
import type { ToolCall } from '../core/tool/types';

let storage: Record<string, unknown>;

beforeEach(() => {
  storage = {};
  vi.stubGlobal('indexedDB', undefined);
  vi.stubGlobal('IDBKeyRange', undefined);
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => {
          storage = { ...storage, ...values };
        }),
        remove: vi.fn(async (key: string) => {
          delete storage[key];
        }),
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runtime externalized tool payloads', () => {
  it('keeps an intermediate chunk failure sticky and skips later writes', async () => {
    const failure = Promise.reject(new Error('middle chunk failed'));
    const laterWrite = vi.fn(async () => undefined);

    await expect(chainExternalizedPayloadWrite(failure, laterWrite))
      .rejects.toThrow('middle chunk failed');
    expect(laterWrite).not.toHaveBeenCalled();
  });

  it('rehydrates and executes large artifact payloads from chunk storage', async () => {
    const callId = 'call-artifact-1';
    const payloadText = JSON.stringify({
      filename: 'reports/long.md',
      content: '# Report\n' + '内容段落\n'.repeat(20000),
      mimeType: 'text/markdown',
    });

    appendExternalizedToolPayloadChunk(callId, 'artifact_create', payloadText.slice(0, 50000));
    appendExternalizedToolPayloadChunk(callId, 'artifact_create', payloadText.slice(50000));

    const result = await executeRuntimeToolCall({
      id: callId,
      name: 'artifact_create',
      invocationName: 'artifact_create',
      payload: createExternalizedToolPayload(callId, 'artifact_create'),
      raw: '<artifact_create>\n...[payload externalized]\n</artifact_create>',
    } satisfies ToolCall, 'manual_chat', 'en');

    expect(result.ok).toBe(true);
    const output = result.output as { artifactId: string; filename: string };
    expect(output.filename).toBe('reports/long.md');
    const record = await getArtifact(output.artifactId);
    expect(record?.content.startsWith('# Report')).toBe(true);
  });
});
