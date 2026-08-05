import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ARTIFACT_PERSISTENCE_CONTRACT } from '../core/artifact/schema';
import type { ToolCall } from '../core/tool/types';
import { deleteIndexedDb } from './helpers/indexeddb';

let storage: Record<string, unknown>;
let artifact: typeof import('../core/artifact');
let artifactStore: typeof import('../core/artifact/store');
let externalizedPayload: typeof import('../core/tool/externalized-payload');
let executeRuntimeToolCall: typeof import('./helpers/production-tool-runtime')['executeRuntimeToolCall'];
let indexedDbFactory: IDBFactory;

beforeEach(async () => {
  vi.resetModules();
  storage = {};
  indexedDbFactory = new IDBFactory();
  vi.stubGlobal('indexedDB', indexedDbFactory);
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => (
          Object.prototype.hasOwnProperty.call(storage, key)
            ? { [key]: storage[key] }
            : {}
        )),
        set: vi.fn(async (values: Record<string, unknown>) => {
          storage = { ...storage, ...values };
        }),
        remove: vi.fn(async (key: string) => {
          delete storage[key];
        }),
      },
    },
  });
  externalizedPayload = await import('../core/tool/externalized-payload');
  ({ executeRuntimeToolCall } = await import('./helpers/production-tool-runtime'));
  artifact = await import('../core/artifact');
  artifactStore = await import('../core/artifact/store');
});

afterEach(async () => {
  artifactStore.db.close();
  await deleteIndexedDb(ARTIFACT_PERSISTENCE_CONTRACT.databaseName);
  vi.unstubAllGlobals();
});

describe('runtime externalized tool payloads', () => {
  it('keeps an intermediate chunk failure sticky and skips later writes', async () => {
    const failure = Promise.reject(new Error('middle chunk failed'));
    const laterWrite = vi.fn(async () => undefined);

    await expect(externalizedPayload.chainExternalizedPayloadWrite(failure, laterWrite))
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

    externalizedPayload.appendExternalizedToolPayloadChunk(callId, 'artifact_create', payloadText.slice(0, 50000));
    externalizedPayload.appendExternalizedToolPayloadChunk(callId, 'artifact_create', payloadText.slice(50000));

    const result = await executeRuntimeToolCall({
      id: callId,
      name: 'artifact_create',
      invocationName: 'artifact_create',
      payload: externalizedPayload.createExternalizedToolPayload(callId, 'artifact_create'),
      raw: '<artifact_create>\n...[payload externalized]\n</artifact_create>',
    } satisfies ToolCall, 'manual_chat', 'en');

    expect(result.ok).toBe(true);
    const output = result.output as { artifactId: string; filename: string };
    expect(output.filename).toBe('reports/long.md');
    const record = await artifact.getArtifact(output.artifactId);
    expect(record?.content.startsWith('# Report')).toBe(true);
  });

  it('returns a retryable parse result without provider I/O when the payload chunk is missing', async () => {
    const callId = 'call-artifact-missing';

    const result = await executeRuntimeToolCall({
      id: callId,
      name: 'artifact_create',
      invocationName: 'artifact_create',
      payload: externalizedPayload.createExternalizedToolPayload(callId, 'artifact_create'),
      raw: '<artifact_create>...[payload externalized]</artifact_create>',
    } satisfies ToolCall, 'manual_chat', 'en');

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'tool_call_external_payload_missing', retryable: true },
    });
    expect(await artifact.getArtifacts()).toEqual([]);
  });

  it('returns the released external-payload parse code without provider I/O for malformed chunks', async () => {
    const callId = 'call-artifact-malformed';
    externalizedPayload.appendExternalizedToolPayloadChunk(callId, 'artifact_create', '{"filename":');

    const result = await executeRuntimeToolCall({
      id: callId,
      name: 'artifact_create',
      invocationName: 'artifact_create',
      payload: externalizedPayload.createExternalizedToolPayload(callId, 'artifact_create'),
      raw: '<artifact_create>...[payload externalized]</artifact_create>',
    } satisfies ToolCall, 'manual_chat', 'en');

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'tool_call_external_payload_invalid', retryable: false },
    });
    expect(await artifact.getArtifacts()).toEqual([]);
  });
});
