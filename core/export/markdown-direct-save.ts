// Bridge between the content UI and the Native Host `local_file_write` chunked
// writer (core/mcp/local-file-write-chunked.ts).
//
// This module runs in the BACKGROUND (service worker). The content script only
// sends { markdown, path } over the runtime message channel; the heavy slicing
// and native-host write happen here so the renderer never holds a large Blob.
//
// When the Native Host is unavailable (no Shell MCP server, no local_file_write
// descriptor, or the write fails), we degrade to a browser download so the
// feature never hard-fails. The manifest does not declare the `downloads`
// permission, so the in-background download branch is effectively a no-op here
// and the content side performs the final anchor-click fallback.

import { callLocalFileWriteChunked } from '../mcp/local-file-write-chunked';
import type {
  McpCallToolOptions,
  McpProtocolTransport,
  McpServerConfig,
} from '../mcp/types';
import type { ToolCall } from '../tool/types';
import { readOptionalChromeApi } from '../platform/chrome-api';

// Runtime message type sent by the content UI (ux-polish.ts) and handled by
// entrypoints/background/local-file-write-handlers.ts.
export const WRITE_MARKDOWN_TO_DIR = 'WRITE_MARKDOWN_TO_DIR';

export interface SaveMarkdownResult {
  method: 'native-host' | 'download';
  ok: boolean;
  error?: string;
}

export interface SaveMarkdownDeps {
  server: McpServerConfig;
  transport: McpProtocolTransport;
  options: McpCallToolOptions;
}

// Write `markdown` to the absolute `path` via the Native Host, degrading to a
// browser download when the native path is unavailable.
export async function saveMarkdownToLocalDir(
  markdown: string,
  path: string,
  deps: SaveMarkdownDeps,
): Promise<SaveMarkdownResult> {
  // Bind path/content here so the (markdown, path) args stay authoritative
  // regardless of what the caller pre-set on options.call.payload.
  const options: McpCallToolOptions = {
    ...deps.options,
    call: {
      ...deps.options.call,
      name: 'local_file_write',
      payload: {
        ...(deps.options.call.payload as Record<string, unknown> | undefined),
        path,
        content: markdown,
      },
    },
  };

  try {
    const result = await callLocalFileWriteChunked(deps.server, deps.transport, options);
    if (result.ok) return { method: 'native-host', ok: true };
    return degradeMarkdownToDownload(markdown, path, result.error);
  } catch (error) {
    return degradeMarkdownToDownload(
      markdown,
      path,
      error instanceof Error ? error.message : String(error),
    );
  }
}

// Final fallback used both when the native write fails AND when no Native Host
// is configured at all. Returns ok:true only if `chrome.downloads.download` is
// actually available (it is not in this project's manifest, so content performs
// the anchor-click fallback instead).
export function degradeMarkdownToDownload(
  markdown: string,
  path: string,
  _reason: string | undefined,
): SaveMarkdownResult {
  const downloadFn = readOptionalChromeApi(
    () => (chrome as typeof chrome & { downloads?: { download?: unknown } }).downloads?.download,
  );
  if (typeof downloadFn === 'function') {
    try {
      const fileName = path.split(/[\\/]/).pop() || 'deepseek-message.md';
      const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
      chrome.downloads.download({ url, filename: fileName });
      return { method: 'download', ok: true };
    } catch (error) {
      return {
        method: 'download',
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return { method: 'download', ok: false, error: 'no_native_host_no_degrade' };
}

// Re-exported so callers can build a ToolCall without importing tool types twice.
export type { ToolCall };
