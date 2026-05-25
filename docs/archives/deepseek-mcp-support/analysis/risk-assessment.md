## Risk Assessment

## S.U.P.E.R Architecture Health Summary

| Principle | Status | Key Findings | Transformation Priority |
|:--|:--|:--|:--|
| S Single Purpose | 🔴 | `content.ts`, `fetch-hook.ts`, `SettingsPage.tsx`, and `constants.ts` already carry multiple responsibilities. MCP will increase this if added inline. | High |
| U Unidirectional Flow | 🟡 | Runtime flow is mostly sound: sidepanel/content -> background -> stores/tabs, content <-> main-world. The weak point is prompt augmentation depending directly on memory/skill internals. | Medium |
| P Ports over Implementation | 🔴 | Existing tool schemas are JSON strings, parser regex is hardcoded, and tool payload validation is ad hoc. MCP needs explicit provider/tool/call/result contracts. | High |
| E Environment-Agnostic | 🟡 | Chrome and DeepSeek page coupling are expected, but endpoint URLs, DOM selectors, and MCP transport assumptions must be isolated. Browser extension cannot directly spawn stdio MCP servers. | High |
| R Replaceable Parts | 🔴 | Adding or replacing tool providers currently touches constants, prompt templates, parser/filtering, content executor, and UI. | High |

Overall health: 2/5 principles healthy enough for incremental work. The codebase is workable, but MCP should begin with architectural refactoring around tools before adding UI breadth.

## S.U.P.E.R Violation Hotspots

| Hotspot | Severity | Why It Matters For MCP |
|:--|:--|:--|
| `core/constants.ts` | High | Built-in memory schemas and tool regex are hardcoded as strings; dynamic MCP tools cannot fit cleanly. |
| `core/interceptor/fetch-hook.ts` | High | Prompt injection and SSE filtering rely on fixed tool names; MCP needs runtime tool descriptors. |
| `entrypoints/content.ts` | High | `executeToolCall` currently handles memory tools inline; adding MCP here would create an unmaintainable executor. |
| `entrypoints/background.ts` | Medium | Already a large router. MCP should be delegated to `core/mcp/*` and surfaced through narrow message actions. |
| `entrypoints/sidepanel/pages/SettingsPage.tsx` | Medium | Too large for full MCP management. A separate MCP page is cleaner. |
| `core/automation/runner.ts` | Medium | Automations bypass the normal UI request path and need explicit MCP prompt/tool execution design. |

## Risk Matrix

| Risk | Impact | Likelihood | Severity | Mitigation |
|:--|:--|:--|:--|:--|
| Browser extension cannot run local stdio MCP servers directly | Feature may be misunderstood or impossible for local-only MCP | High | High | Define first supported transports as HTTP/SSE/Streamable HTTP, or require a companion bridge/native messaging later. |
| Dynamic tool schemas break XML stripping/filtering | Raw tool blocks may leak into DeepSeek UI/history | Medium | High | Replace hardcoded regex with descriptor-driven parser/filter tests before adding MCP execution. |
| MCP calls expose private data or arbitrary network access | Security and trust risk | Medium | High | Add per-server enablement, per-tool allowlist, confirmation policy for risky tools, and result size limits. |
| Automation runs cannot execute MCP tools consistently | Scheduled tasks produce tool XML but no execution loop | Medium | High | Design shared tool execution path for both live chat and automation; do not assume fetch-hook alone is enough. |
| Long MCP tool results exceed prompt or UI budget | Chat becomes noisy or breaks response rendering | Medium | Medium | Add result summarization, truncation, and structured display metadata. |
| MV3 service worker lifetime interrupts MCP calls | Tool calls fail during suspended background worker or long-running requests | Medium | Medium | Keep calls bounded, persist call state, and surface timeout/retry status in result cards. |
| Permission prompts become confusing | Users may grant broad host permissions without context | Medium | Medium | Request origins per MCP server URL and show connection state in sidepanel. |

## High-Severity Risks

### MCP Transport Reality

The browser extension can call HTTP endpoints after host permission is granted, but it cannot spawn arbitrary local stdio MCP servers the way a desktop agent can. Supporting local MCP servers requires one of:

- a local HTTP/WebSocket MCP bridge started outside the extension
- Chrome native messaging host
- a remote MCP endpoint over HTTP/SSE/Streamable HTTP

The first implementation should explicitly support browser-compatible transports and avoid claiming generic stdio MCP support.

### Tool Contract Refactor

Current tool infrastructure is memory-specific:

- `TOOL_NAMES` is fixed to memory tool names
- `TOOL_CALL_REGEX` only matches those names
- prompt templates embed hardcoded memory schemas
- `executeToolCall` branches on memory names

MCP requires a provider-neutral contract:

```text
ToolProvider -> ToolDescriptor[] -> Prompt schema renderer -> XML parser/filter
ToolCall -> ToolExecutor -> ToolResult -> UI result block
```

### Automation Compatibility

Manual chats use fetch/XHR interception. Automations call DeepSeek APIs from `core/automation/runner.ts` inside main-world. They may not automatically inherit the same dynamic MCP schema and execution loop unless the prompt augmentation and tool execution abstractions are shared.

## Technical Debt

- No dedicated test runner, despite several pure modules that should be testable.
- Runtime message payloads are TypeScript typed but not validated at the boundary.
- Large files exceed comfortable change size:
  - `entrypoints/content.ts`: 1012 lines
  - `core/interceptor/fetch-hook.ts`: 917 lines
  - `entrypoints/sidepanel/pages/SettingsPage.tsx`: 662 lines
  - `core/automation/runner.ts`: 595 lines
  - `entrypoints/sidepanel/pages/AutomationPage.tsx`: 569 lines
- Tool schemas are not structured data; this blocks safe dynamic MCP schema injection.
- DOM selectors rely on DeepSeek markup and need defensive fallback behavior.

## Compatibility Concerns

- Existing memory tools must remain backward-compatible with stored/visible/restored tool execution blocks.
- Legacy DSML tool parsing should keep working unless explicitly deprecated.
- WebDAV sync currently syncs memory/skills/presets only; MCP config may contain secrets and should not be synced by default.
- MCP server credentials should not be exported with normal memory backups.
- Host permission flow must continue to work under Chrome MV3 and WXT manifest generation.
- Result rendering should remain visually consistent with the existing "已执行工具" block.
