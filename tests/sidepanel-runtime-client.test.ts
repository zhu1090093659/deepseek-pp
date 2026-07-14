import { describe, expect, it, vi } from 'vitest';
import { createRequestGenerationFence } from '../entrypoints/sidepanel/async-state';
import {
  SidepanelRuntimeError,
  createSidepanelRuntimeClient,
} from '../entrypoints/sidepanel/runtime-client';

describe('sidepanel runtime client', () => {
  it('sends typed requests and decodes successful responses', async () => {
    const transport = vi.fn(async () => ({ version: '1.10.0' }));
    const client = createSidepanelRuntimeClient(transport);

    await expect(client.request(
      { type: 'GET_CONFIG' },
      {
        decode(value) {
          const version = (value as { version?: unknown }).version;
          if (typeof version !== 'string') throw new Error('invalid version');
          return version;
        },
      },
    )).resolves.toBe('1.10.0');
    expect(transport).toHaveBeenCalledWith({ type: 'GET_CONFIG' });
  });

  it.each([
    ['transport', async (): Promise<unknown> => { throw new Error('extension context invalidated'); }],
    ['unavailable', async (): Promise<unknown> => undefined],
    ['command', async (): Promise<unknown> => ({ ok: false, error: 'denied' })],
  ] as const)('projects %s failures through one stable error type', async (kind, transport) => {
    const client = createSidepanelRuntimeClient(transport);

    const error = await client.request({ type: 'GET_CONFIG' }).catch((caught) => caught);
    expect(error).toBeInstanceOf(SidepanelRuntimeError);
    expect(error).toMatchObject({ kind, command: 'GET_CONFIG' });
  });

  it('projects decoder failures as protocol errors', async () => {
    const client = createSidepanelRuntimeClient(async () => ({ version: 1 }));

    const error = await client.request(
      { type: 'GET_CONFIG' },
      { decode: () => { throw new Error('invalid config'); } },
    ).catch((caught) => caught);
    expect(error).toMatchObject({ kind: 'protocol', command: 'GET_CONFIG' });
    expect(error.message).toBe('invalid config');
  });

  it('uses the shared runtime failure predicate for structured-clone objects and arrays', async () => {
    const arrayFailure = Object.assign([], { ok: false, error: 'array failure' });
    const client = createSidepanelRuntimeClient(async () => arrayFailure);

    const error = await client.request({ type: 'GET_CONFIG' }).catch((caught) => caught);
    expect(error).toMatchObject({
      kind: 'command',
      command: 'GET_CONFIG',
      message: 'array failure',
    });
  });

  it('lets a controller decode commands whose typed status can be ok false', async () => {
    const client = createSidepanelRuntimeClient(async () => ({ ok: false, origins: [] }));

    await expect(client.request(
      { type: 'REQUEST_HOST_PERMISSION', payload: { origins: ['https://example.com/*'] } },
      {
        acceptFailure: true,
        decode: (value) => (value as { ok: boolean }).ok,
      },
    )).resolves.toBe(false);
  });
});

describe('sidepanel request generation fence', () => {
  it('invalidates stale work on a newer request and on teardown', () => {
    const fence = createRequestGenerationFence();
    const first = fence.begin();
    const second = fence.begin();

    expect(fence.isCurrent(first)).toBe(false);
    expect(fence.isCurrent(second)).toBe(true);
    fence.invalidate();
    expect(fence.isCurrent(second)).toBe(false);
  });
});
