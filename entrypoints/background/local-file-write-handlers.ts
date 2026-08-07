// Background handler for the "save markdown to local directory" feature.
//
// The content script (ux-polish.ts) sends WRITE_MARKDOWN_TO_DIR with the raw
// markdown and an absolute target path. Here, in the background, we resolve the
// Shell Native Host MCP server + its native-messaging transport + the
// local_file_write descriptor (the exact `server`/`transport`/`descriptor`
// triple used by callLocalFileReadAuto in core/mcp/client.ts), then delegate the
// chunked write to saveMarkdownToLocalDir, which also owns the degrade logic.

import {
  degradeMarkdownToDownload,
  saveMarkdownToLocalDir,
  type SaveMarkdownResult,
} from '../../core/export/markdown-direct-save';
import { getAllMcpServers } from '../../core/mcp/store';
import { isShellMcpServer } from '../../core/shell';
import { createMcpTransport } from '../../core/mcp/transports';
import { getMcpToolDescriptors } from '../../core/mcp/discovery';
import type { McpCallToolOptions } from '../../core/mcp/types';
import type { ToolCall } from '../../core/tool/types';

const LOCAL_FILE_WRITE_TOOL = 'local_file_write';

export interface WriteMarkdownToDirPayload {
  markdown?: unknown;
  path?: unknown;
}

// Resolve the Shell Native Host and stream the markdown to the requested path.
// Returns a SaveMarkdownResult that the background message router sends back.
export async function handleWriteMarkdownToDir(
  payload: WriteMarkdownToDirPayload,
  _sender?: unknown,
): Promise<SaveMarkdownResult> {
  const markdown = typeof payload?.markdown === 'string' ? payload.markdown : '';
  const path = typeof payload?.path === 'string' ? payload.path : '';
  if (!markdown || !path) {
    return { method: 'download', ok: false, error: 'missing_markdown_or_path' };
  }

  // Runtime probe for the Native Host: if no configured/enabled Shell MCP server
  // exists, local_file_write cannot run -> degrade.
  const servers = await getAllMcpServers({ includeSecrets: true });
  const server = servers.find((item) => isShellMcpServer(item));
  if (!server) {
    return degradeMarkdownToDownload(markdown, path, 'native_host_not_configured');
  }

  const transport = createMcpTransport(server);

  // The descriptor doubles as the runtime availability signal: if discovery has
  // not surfaced local_file_write (Native Host absent or not connected), treat
  // it as unavailable and degrade.
  const descriptors = await getMcpToolDescriptors({ includeDisabled: true });
  const descriptor = descriptors.find(
    (item) =>
      item.name === LOCAL_FILE_WRITE_TOOL &&
      item.provider.kind === 'mcp' &&
      item.provider.id === server.id,
  );
  if (!descriptor) {
    return degradeMarkdownToDownload(markdown, path, 'local_file_write_descriptor_missing');
  }

  const call: ToolCall = {
    name: LOCAL_FILE_WRITE_TOOL,
    provider: {
      kind: 'mcp',
      id: server.id,
      displayName: server.displayName,
      transport: server.transport.kind,
    },
    descriptorId: descriptor.id,
    payload: { path },
    raw: JSON.stringify({ path }),
  };

  const options: McpCallToolOptions = { call, descriptor };

  return saveMarkdownToLocalDir(markdown, path, { server, transport, options });
}
