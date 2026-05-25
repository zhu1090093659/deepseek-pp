## MCP Operator Notes

Date: 2026-05-21

### Supported Transports

- Streamable HTTP: preferred remote MCP path for current HTTP servers.
- HTTP: JSON-RPC POST against a configured MCP endpoint.
- SSE: legacy MCP SSE endpoint plus POST callback flow.
- Stdio Bridge: browser talks to a local HTTP bridge; the bridge owns process launch and stdio.
- Native Messaging: the browser talks to an installed native messaging host.

Reference specs:

- Lifecycle: https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle
- Transports: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- Tools: https://modelcontextprotocol.io/specification/draft/server/tools

### Reload Requirements

After source changes:

1. Run the build command for the target browser.
2. Open the browser extension management page.
3. Reload the matching unpacked extension directory.
4. Refresh existing `https://chat.deepseek.com/` tabs so the content and main-world scripts pick up the new bundle.

| Browser | Command | Reload target |
|:--|:--|:--|
| Chrome | `npm run build:chrome` | `dist/chrome-mv3/` in `chrome://extensions/` |
| Edge | `npm run build:edge` | `dist/edge-mv3/` in `edge://extensions/` |
| Firefox | `npm run build:firefox` | `dist/firefox-mv3/manifest.json` in `about:debugging#/runtime/this-firefox` |

### MCP Setup Checklist

1. Open the DeepSeek++ sidepanel.
2. Go to `MCP`.
3. Add a server and choose its transport.
4. For HTTP/SSE/bridge transports, click `授权` and approve the browser host permission.
5. Click `测试` to verify initialize/list behavior and latency.
6. Click `刷新工具` to populate the cache.
7. Confirm each tool's enabled state. Only tools with server `auto` policy and enabled tool state are injected into prompts.

### Verification Commands

```bash
npm run verify:mcp:mock
npm run smoke:mcp
npm run compile
npm run build:all
```

For browser manual verification with a loopback server:

```bash
node scripts/mcp-live-mock.mjs --serve
```

Use the printed URL as a Streamable HTTP MCP server in the sidepanel.

### Limits

- Connect timeout: 10,000 ms by default.
- Request timeout: 60,000 ms by default.
- Discovery timeout: 20,000 ms by default.
- Max result bytes: 64,000 by default.
- Max tool count per server: 128 by default.
- Manual and automation MCP continuations are capped at 3 rounds.

### Troubleshooting

- `mcp_origin_permission_denied`: grant host permission from the MCP sidepanel or remove/re-add the server URL.
- `mcp_endpoint_invalid`: use an `http://` or `https://` URL for browser transports.
- `mcp_sse_endpoint_missing`: the SSE server did not emit the endpoint event expected by the legacy transport.
- `mcp_native_host_unavailable`: install or fix the browser native messaging host manifest.
- Tool is discovered but not injected: check server enabled state, execution mode, and per-tool allow/deny state.
- Stdio server does not start: verify the bridge process, command, args, cwd, and env. The extension itself does not launch stdio processes directly.
