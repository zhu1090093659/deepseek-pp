import { describe, expect, it, vi } from 'vitest';
import {
  ToolProviderRegistry,
  type RuntimeToolProvider,
  type ToolProviderRegistration,
} from '../core/tool/provider-registry';
import type { ToolCall, ToolDescriptor, ToolProviderIdentity, ToolResult } from '../core/tool/types';

const CONTEXT = { locale: 'en' as const, includeDisabled: false };
const EXECUTION_CONTEXT = { locale: 'en' as const };

describe('ToolProviderRegistry', () => {
  it('preserves registration order while allowing tool-name collisions', async () => {
    const localDescriptor = makeDescriptor(localIdentity('memory'), 'local:memory:shared', 'shared_local');
    const mcpDescriptor = makeDescriptor(mcpIdentity('remote'), 'mcp:remote:shared', 'shared_remote');
    const registry = new ToolProviderRegistry([
      makeProvider({ kind: 'local', id: 'memory' }, [localDescriptor]),
      makeProvider({ kind: 'mcp' }, [mcpDescriptor]),
    ]);

    await expect(registry.listTools(CONTEXT)).resolves.toEqual([localDescriptor, mcpDescriptor]);
  });

  it('routes by the authorized descriptor provider before the colliding name', async () => {
    const localExecute = vi.fn(async (): Promise<ToolResult> => ({ ok: true, summary: 'local' }));
    const mcpExecute = vi.fn(async (): Promise<ToolResult> => ({ ok: true, summary: 'mcp' }));
    const localDescriptor = makeDescriptor(localIdentity('memory'), 'local:memory:shared', 'shared_local');
    const mcpDescriptor = makeDescriptor(mcpIdentity('remote'), 'mcp:remote:shared', 'shared_remote');
    const registry = new ToolProviderRegistry([
      makeProvider({ kind: 'local', id: 'memory' }, [localDescriptor], localExecute),
      makeProvider({ kind: 'mcp' }, [mcpDescriptor], mcpExecute),
    ]);
    const call = makeCall(mcpDescriptor);

    await expect(registry.execute(call, mcpDescriptor, EXECUTION_CONTEXT)).resolves.toEqual({
      ok: true,
      summary: 'mcp',
    });
    expect(mcpExecute).toHaveBeenCalledWith(call, mcpDescriptor, EXECUTION_CONTEXT);
    expect(localExecute).not.toHaveBeenCalled();
  });

  it('rejects duplicate provider registrations', () => {
    expect(() => new ToolProviderRegistry([
      makeProvider({ kind: 'local', id: 'memory' }),
      makeProvider({ kind: 'local', id: 'memory' }),
    ])).toThrowError(expect.objectContaining({ code: 'tool_provider_duplicate' }));
  });

  it('rejects descriptors owned by a different registered provider', async () => {
    const foreign = makeDescriptor(localIdentity('web'), 'local:web:foreign', 'foreign');
    const registry = new ToolProviderRegistry([
      makeProvider({ kind: 'local', id: 'memory' }, [foreign]),
      makeProvider({ kind: 'local', id: 'web' }),
    ]);

    await expect(registry.listTools(CONTEXT)).rejects.toMatchObject({
      code: 'tool_provider_descriptor_mismatch',
    });
  });

  it('rejects a local descriptor that claims a non-process transport', async () => {
    const foreign = makeDescriptor(
      { ...localIdentity('memory'), transport: 'native_messaging' },
      'local:memory:foreign-transport',
      'foreign_transport',
    );
    const registry = new ToolProviderRegistry([
      makeProvider({ kind: 'local', id: 'memory' }, [foreign]),
    ]);

    await expect(registry.listTools(CONTEXT)).rejects.toMatchObject({
      code: 'tool_provider_descriptor_mismatch',
    });
  });

  it.each([
    ['descriptor id', 'tool_descriptor_duplicate', (descriptor: ToolDescriptor) => ({
      ...descriptor,
      invocationName: `${descriptor.invocationName}_other`,
    })],
    ['invocation name', 'tool_invocation_duplicate', (descriptor: ToolDescriptor) => ({
      ...descriptor,
      id: `${descriptor.id}:other`,
    })],
  ])('rejects a duplicate %s', async (_label, code, createDuplicate) => {
    const descriptor = makeDescriptor(localIdentity('memory'), 'local:memory:one', 'one');
    const registry = new ToolProviderRegistry([
      makeProvider({ kind: 'local', id: 'memory' }, [descriptor, createDuplicate(descriptor)]),
    ]);

    await expect(registry.listTools(CONTEXT)).rejects.toMatchObject({ code });
  });

  it('rejects an unknown provider without invoking a registered provider', async () => {
    const execute = vi.fn();
    const registry = new ToolProviderRegistry([
      makeProvider({ kind: 'local', id: 'memory' }, [], execute),
    ]);
    const descriptor = makeDescriptor(localIdentity('unknown'), 'local:unknown:tool', 'unknown');

    await expect(registry.execute(makeCall(descriptor), descriptor, EXECUTION_CONTEXT)).rejects.toEqual(
      expect.objectContaining({ code: 'tool_provider_unknown' }),
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects a local execution identity with a non-process transport', async () => {
    const execute = vi.fn();
    const registry = new ToolProviderRegistry([
      makeProvider({ kind: 'local', id: 'memory' }, [], execute),
    ]);
    const descriptor = makeDescriptor(
      { ...localIdentity('memory'), transport: 'native_messaging' },
      'local:memory:foreign-transport',
      'foreign_transport',
    );

    await expect(registry.execute(makeCall(descriptor), descriptor, EXECUTION_CONTEXT)).rejects.toEqual(
      expect.objectContaining({ code: 'tool_provider_unknown' }),
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('propagates provider failures without trying another provider', async () => {
    const failure = new Error('provider failed');
    const firstExecute = vi.fn(async () => { throw failure; });
    const secondExecute = vi.fn();
    const descriptor = makeDescriptor(localIdentity('memory'), 'local:memory:tool', 'memory_tool');
    const registry = new ToolProviderRegistry([
      makeProvider({ kind: 'local', id: 'memory' }, [descriptor], firstExecute),
      makeProvider({ kind: 'mcp' }, [], secondExecute),
    ]);

    await expect(registry.execute(makeCall(descriptor), descriptor, EXECUTION_CONTEXT)).rejects.toBe(failure);
    expect(secondExecute).not.toHaveBeenCalled();
  });
});

function makeProvider(
  registration: ToolProviderRegistration,
  descriptors: ToolDescriptor[] = [],
  execute = vi.fn(async (): Promise<ToolResult> => ({ ok: true, summary: 'ok' })),
): RuntimeToolProvider {
  return {
    registration,
    async listTools() {
      return descriptors;
    },
    execute,
  };
}

function localIdentity(id: string): ToolProviderIdentity {
  return { kind: 'local', id, displayName: id, transport: 'in_process' };
}

function mcpIdentity(id: string): ToolProviderIdentity {
  return { kind: 'mcp', id, displayName: id, transport: 'native_messaging' };
}

function makeDescriptor(
  provider: ToolProviderIdentity,
  id: string,
  invocationName: string,
): ToolDescriptor {
  return {
    id,
    provider,
    name: 'shared_name',
    invocationName,
    title: invocationName,
    description: invocationName,
    inputSchema: { type: 'object' },
    execution: { mode: 'auto', enabled: true, risk: 'low' },
  };
}

function makeCall(descriptor: ToolDescriptor): ToolCall {
  return {
    descriptorId: descriptor.id,
    provider: descriptor.provider,
    name: descriptor.name,
    invocationName: descriptor.invocationName,
    payload: {},
    raw: '',
  };
}
