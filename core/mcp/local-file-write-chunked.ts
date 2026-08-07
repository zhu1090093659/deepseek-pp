// Chunked direct-write scheduler that mirrors callLocalFileReadAuto (client.ts:236-386) but writes
// instead of reads. It calls the Shell Native Host tool `local_file_write` in a deterministic loop:
// the first chunk uses `append:false` (create the file, also creating parent directories), every
// subsequent chunk uses `append:true`. Each chunk response is integrity-checked via `data.sizeMatch`;
// any mismatch or transport error is fail-closed (never reported as success).
//
// This module runs in the background (service worker) because the Native Host MCP transport lives
// there; a content script cannot call `local_file_write` directly.
import type {
  McpCallToolOptions,
  McpCallToolResult,
  McpProtocolTransport,
  McpServerConfig,
} from './types';
import {
  createMcpRequest,
  getMcpToolName,
  normalizeMcpToolResult,
  unwrapMcpResponse,
} from './client';
import { splitMarkdownIntoShellChunks } from '../export/markdown-chunker';

export interface LocalFileWriteChunkedResult {
  ok: boolean;
  path: string;
  bytesWritten: number;
  truncated: boolean;
  error?: string;
}

export async function callLocalFileWriteChunked(
  server: McpServerConfig,
  transport: McpProtocolTransport,
  options: McpCallToolOptions,
): Promise<LocalFileWriteChunkedResult> {
  const startedAt = Date.now();
  const call = options.call;
  const payload = call.payload as Record<string, unknown> | undefined;
  const path = String(payload?.path ?? '');
  const content = typeof payload?.content === 'string' ? payload.content : '';

  // Mirror callLocalFileReadAuto: split the full markdown into Shell-sized chunks that never cut a
  // multi-byte character (UTF-8 byte-boundary safe, <= SHELL_WRITE_CHUNK_LIMIT_BYTES each).
  const chunks = splitMarkdownIntoShellChunks(content);

  let bytesWritten = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    // First chunk creates the file (append:false); the rest continue it (append:true).
    const append = i > 0;
    let windowResult: McpCallToolResult;
    try {
      const response = await transport.request<Record<string, unknown>, McpCallToolResult>(
        createMcpRequest('tools/call', {
          name: getMcpToolName(call, options.descriptor),
          arguments: { ...payload, path, content: chunk, append, create_directories: true },
        }),
        {
          timeoutMs: options.timeoutMs ?? server.timeouts.requestMs,
          maxResponseBytes: options.maxResultBytes ?? server.limits.maxResultBytes,
          signal: options.signal,
        },
      );
      windowResult = unwrapMcpResponse(response, 'mcp_tool_call_failed') as McpCallToolResult;
    } catch (err) {
      // fail-closed: a transport/parse failure must never be reported as a successful write.
      return {
        ok: false,
        path,
        bytesWritten,
        truncated: true,
        error: `chunk ${i + 1}/${chunks.length} write failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const data = (windowResult.structuredContent as Record<string, unknown> | undefined)?.data as
      | Record<string, unknown>
      | undefined;

    // sizeMatch guard from the Shell Native Host: the bytes actually on disk must match the chunk
    // size. If sizeMatch is false (or missing) the write is not integrity-confirmed -> fail-closed.
    const sizeMatch = data?.sizeMatch === true;
    if (!sizeMatch) {
      return {
        ok: false,
        path,
        bytesWritten,
        truncated: true,
        error: `chunk ${i + 1}/${chunks.length} sizeMatch=false (write integrity unconfirmed)`,
      };
    }

    const chunkBytes = typeof data?.bytesWritten === 'number'
      ? data.bytesWritten
      : new TextEncoder().encode(chunk).byteLength;
    bytesWritten += chunkBytes;
  }

  // Aggregate the flat outcome and route it through the same normalization used by the read path
  // (normalizeMcpToolResult), so the unified maxResultBytes cap is applied and no bypassing return
  // path is opened. The flat LocalFileWriteChunkedResult is then mapped from the normalized ToolResult.
  const detail = `Wrote ${bytesWritten} bytes to ${path} in ${chunks.length} chunk(s) via local_file_write (Native Host).`;
  const aggregated: McpCallToolResult = {
    content: [{ type: 'text', text: detail }],
    structuredContent: {
      data: {
        path,
        chunks: chunks.length,
        bytesWritten,
        truncated: false,
      },
    },
    isError: false,
  };
  const normalized = normalizeMcpToolResult(server, call, aggregated, startedAt, options.maxResultBytes);
  return {
    ok: normalized.ok,
    path,
    bytesWritten,
    truncated: normalized.truncated ?? false,
    ...(normalized.error ? { error: normalized.error.message } : {}),
  };
}
