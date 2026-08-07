// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { callLocalFileWriteChunked } from '../core/mcp/local-file-write-chunked';
import type { McpServerConfig, McpProtocolTransport, McpCallToolResult } from '../core/mcp/types';

// Shell Native Host identity (displayName hits SHELL_MCP_SERVER_NAME), matching the read-path mock.
function makeServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 's', displayName: 'Shell Local', enabled: true,
    transport: { kind: 'native_messaging', nativeHost: 'com.deepseek_pp.shell' },
    timeouts: { connectMs: 0, requestMs: 30000, discoveryMs: 0 },
    limits: { maxResultBytes: 64000, maxToolCount: 100 },
    version: 1, status: 'ready', lastConnectedAt: null, lastError: null,
    createdAt: 0, updatedAt: 0, headers: [], secrets: [],
    allowlist: { mode: 'all', toolNames: [] },
    execution: { mode: 'local', enabled: true },
    ...overrides,
  } as unknown as McpServerConfig;
}

// Mirror tests/local-file-read-auto.test.ts transport mock, but driven by local_file_write semantics.
function makeWriteTransport(
  handler: (args: { path: string; content: string; append: boolean; create_directories: boolean }) => McpCallToolResult,
): McpProtocolTransport {
  const request = async (req: unknown) => {
    const args = (req as { params?: { arguments?: Record<string, unknown> } })?.params?.arguments ?? {};
    const result = handler({
      path: String(args.path ?? ''),
      content: typeof args.content === 'string' ? args.content : '',
      append: args.append === true,
      create_directories: args.create_directories === true,
    });
    return {
      jsonrpc: '2.0',
      id: 1,
      result,
    } as unknown as Awaited<ReturnType<McpProtocolTransport['request']>>;
  };
  return { request } as unknown as McpProtocolTransport;
}

// A host-shaped local_file_write response. The mock computes bytesWritten from the actual chunk so
// the summed bytesWritten equals the full content length regardless of how the chunker splits.
function writeResponse(content: string, sizeMatch: boolean): McpCallToolResult {
  const bytes = new TextEncoder().encode(content).byteLength;
  return {
    content: [{ type: 'text', text: `Wrote ${bytes} bytes` }],
    structuredContent: {
      ok: true,
      data: { path: '/x', append: false, bytesWritten: bytes, sizeMatch },
    },
  };
}

describe('callLocalFileWriteChunked (chunked native write)', () => {
  const server = makeServer();

  it('writes chunks via local_file_write (first append:false, rest append:true) and reports ok:true', async () => {
    const content = '# Title\n\n中文内容 🌍 emoji 混合 ' + 'x'.repeat(5000);
    const expectedBytes = new TextEncoder().encode(content).byteLength;
    const calls: Array<{ append: boolean; create_directories: boolean }> = [];
    const transport = makeWriteTransport((args) => {
      calls.push({ append: args.append, create_directories: args.create_directories });
      return writeResponse(args.content, true);
    });
    const call = { name: 'local_file_write', payload: { path: '/tmp/out.md', content } } as never;
    const result = await callLocalFileWriteChunked(server, transport, { call } as never);

    expect(result.ok).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.bytesWritten).toBe(expectedBytes); // full content written, no silent loss
    expect(calls.length).toBeGreaterThanOrEqual(1);
    // First chunk creates the file with recursive parent-dir creation.
    expect(calls[0].append).toBe(false);
    expect(calls[0].create_directories).toBe(true);
    // Every subsequent chunk appends.
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i].append).toBe(true);
      expect(calls[i].create_directories).toBe(true);
    }
  });

  it('fail-closed when a chunk returns sizeMatch:false (never reported as success)', async () => {
    const content = 'hello world\n' + 'y'.repeat(2000);
    const transport = makeWriteTransport((args) => writeResponse(args.content, false));
    const call = { name: 'local_file_write', payload: { path: '/tmp/out.md', content } } as never;
    const result = await callLocalFileWriteChunked(server, transport, { call } as never);

    expect(result.ok).toBe(false);
    expect(result.truncated).toBe(true); // integrity guard tripped -> fail-closed
    expect(typeof result.error).toBe('string');
  });

  it('fail-closed when the transport throws', async () => {
    const content = 'some content';
    const transport = {
      request: async () => {
        throw new Error('native host boom');
      },
    } as unknown as McpProtocolTransport;
    const call = { name: 'local_file_write', payload: { path: '/tmp/out.md', content } } as never;
    const result = await callLocalFileWriteChunked(server, transport, { call } as never);

    expect(result.ok).toBe(false);
    expect(result.truncated).toBe(true);
    expect(typeof result.error).toBe('string');
  });
});
