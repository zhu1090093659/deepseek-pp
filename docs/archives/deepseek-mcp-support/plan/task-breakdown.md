## Task Breakdown

## Confirmed Task Definition

Build MCP support into DeepSeek++ with the broadest practical transport coverage: direct browser HTTP/SSE/Streamable HTTP MCP endpoints plus local stdio support through a bridge or Chrome native messaging adapter. MCP tools should execute automatically by default, and both manual DeepSeek chats and scheduled automations must share the same MCP tool discovery, prompt injection, execution, and result-continuation pipeline.

## Overview

- Total phases: 5
- Total tasks: 21
- Estimated total effort: XL
- Tracking mode: GITHUB_STANDARD

## S.U.P.E.R Design Constraints

- S: Keep tool contracts, MCP transports, execution routing, UI, and automation loops in separate modules.
- U: Preserve flow: sidepanel/content -> background -> provider/transport -> result; main-world only handles page-context DeepSeek APIs.
- P: Define serializable contracts before implementation: `ToolDescriptor`, `ToolCall`, `ToolResult`, `McpServerConfig`, `McpTransportRequest`.
- E: No hidden global assumptions. Transport type, URL/native host, auth headers, timeout, result size, and enabled tools come from user config.
- R: Built-in memory tools and MCP tools must both be replaceable providers behind the same execution interface.

## Phase 1: Tool Platform Refactor

Goal: Convert the current hardcoded memory-tool system into a provider-neutral tool platform that can host MCP tools without breaking existing memory behavior.

Prerequisite: Confirmed MCP scope.

S.U.P.E.R focus: S, P, R.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|
| T1.1 | Define provider-neutral tool contracts | P0 | M | - | A | P, R | Add serializable descriptor/call/result types; cover built-in and MCP tool identity; compile passes. |
| T1.2 | Refactor memory tools into a local provider | P0 | M | T1.1 | A | S, R | Memory save/update/delete are exposed through the generic provider interface; existing behavior remains compatible. |
| T1.3 | Make XML parsing and stream filtering descriptor-driven | P0 | L | T1.1 | B | P, R | Parser/filter accepts runtime tool names; legacy memory and DSML parsing remain supported; raw tool XML is still hidden. |
| T1.4 | Add shared prompt augmentation service for chat and automation | P0 | L | T1.2, T1.3 | C | U, P | Preset, skill, memory, and tool schema injection can be reused outside `fetch-hook.ts`; compile passes. |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T1.1, T1.2 | L | Medium | `core/types.ts`, `core/tool/*`, `entrypoints/content.ts` |
| B | T1.3 | L | Medium | `core/interceptor/*`, `core/constants.ts` |
| C | T1.4 | L | High | `core/memory/injector.ts`, `core/interceptor/fetch-hook.ts`, `core/automation/runner.ts` |

## Phase 2: MCP Transport And Server Registry

Goal: Add MCP server configuration, discovery, transport adapters, and bounded execution primitives.

Prerequisite: Phase 1 contracts exist.

S.U.P.E.R focus: P, E, R.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|
| T2.1 | Add MCP server config store and secret policy | P0 | M | T1.1 | A | P, E | Store enabled servers, transport type, endpoint/native host, headers, timeouts, tool allowlist; secrets excluded from normal sync/export. |
| T2.2 | Implement MCP protocol core | P0 | L | T1.1 | B | P, R | Implement initialize, list tools, call tool normalization with structured request/result/error types. |
| T2.3 | Add browser HTTP/SSE/Streamable HTTP transports | P0 | L | T2.2 | B | E, R | Direct browser transports work through fetch/event stream paths and request host permission by origin. |
| T2.4 | Add stdio bridge and native messaging adapters | P1 | L | T2.2 | C | E, R | Local stdio-backed MCP servers can be reached through configured bridge URL or native host adapter contract. |
| T2.5 | Add discovery cache, health checks, timeouts, and result caps | P1 | M | T2.1, T2.2 | A | P, E | Tool discovery is cached per server; failures expose structured status; calls are bounded by timeout and result size. |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T2.1, T2.5 | L | Medium | `core/mcp/store.ts`, `core/mcp/types.ts` |
| B | T2.2, T2.3 | XL | Medium | `core/mcp/client.ts`, `core/mcp/transports/*` |
| C | T2.4 | L | Low | `core/mcp/transports/native.ts`, `core/mcp/transports/bridge.ts` |

## Phase 3: Chat And Automation MCP Execution

Goal: Wire MCP discovery and automatic execution into both manual chats and scheduled automations, including result continuation loops.

Prerequisite: Phases 1 and 2 complete.

S.U.P.E.R focus: U, P, R.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|
| T3.1 | Add background tool registry and MCP runtime messages | P0 | M | T1.4, T2.5 | A | U, P | Background exposes get tools, refresh tools, execute call, and call history actions via typed messages. |
| T3.2 | Sync dynamic tool descriptors into main-world hook | P0 | L | T3.1 | B | U, P | Manual chats receive memory and MCP schemas; parser/filter uses the same dynamic descriptor set. |
| T3.3 | Implement automatic MCP result continuation for manual chats | P0 | XL | T3.2 | B | U, P | After MCP calls execute, the extension automatically sends bounded tool results back into the same DeepSeek session up to a max iteration count. |
| T3.4 | Implement automation MCP execution loop | P0 | XL | T3.1, T2.5 | C | U, P | Scheduled/manual automation runs execute MCP calls automatically and continue the same automation session with tool results. |
| T3.5 | Persist MCP call history and restore result blocks | P1 | M | T3.3, T3.4 | A | S, R | MCP result cards survive refresh and automation history records include tool call summaries without leaking secrets. |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T3.1, T3.5 | L | Medium | `entrypoints/background.ts`, `core/mcp/*`, `core/types.ts` |
| B | T3.2, T3.3 | XL | High | `core/interceptor/fetch-hook.ts`, `entrypoints/content.ts`, `entrypoints/main-world.content.ts` |
| C | T3.4 | XL | Medium | `core/automation/runner.ts`, `core/automation/types.ts` |

## Phase 4: MCP Sidepanel And Permissions

Goal: Provide a complete management UI for MCP servers, tools, connection status, and automatic execution defaults.

Prerequisite: MCP store and runtime actions exist.

S.U.P.E.R focus: S, E, R.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|
| T4.1 | Add MCP sidepanel tab and server list/detail views | P1 | L | T2.1 | A | S, R | A dedicated MCP tab shows configured servers, enabled state, transport type, status, and discovered tool count. |
| T4.2 | Add server editor for all supported transports | P1 | L | T4.1, T2.1 | A | E, P | Users can configure HTTP/SSE/Streamable HTTP, bridge, and native messaging fields with validation. |
| T4.3 | Add discovered tool management and automatic execution defaults | P1 | M | T4.1, T3.1 | B | P, E | Users can refresh tools, enable/disable servers/tools, and see that auto execution is the default policy. |
| T4.4 | Add connection testing, permission prompts, and call result states | P1 | M | T4.2, T4.3 | C | E, R | UI can request host permissions, test connections, display errors, and link recent call outcomes. |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T4.1, T4.2 | XL | Medium | `entrypoints/sidepanel/App.tsx`, `entrypoints/sidepanel/pages/McpPage.tsx` |
| B | T4.3 | M | Medium | `entrypoints/sidepanel/pages/McpPage.tsx`, `core/mcp/types.ts` |
| C | T4.4 | M | Medium | `entrypoints/sidepanel/pages/McpPage.tsx`, `entrypoints/background.ts` |

## Phase 5: Verification And Documentation

Goal: Prove the MCP implementation works for manual chats and automations, then document supported transports and operational limits.

Prerequisite: Phases 1-4 complete.

S.U.P.E.R focus: P, E.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|
| T5.1 | Add compile-time and pure MCP smoke checks | P0 | M | T4.4 | A | P | `npm run compile` and `npm run build` pass; protocol/transport/parser smoke checks cover representative MCP calls. |
| T5.2 | Run live verification with mock MCP and automation | P0 | L | T5.1 | A | E | Manual chat and automation task both execute a mock MCP tool automatically and continue with results. |
| T5.3 | Update README and operator notes | P1 | S | T5.2 | B | E | README explains supported transports, local bridge/native messaging requirements, default auto-execution, and automation compatibility. |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| A | T5.1, T5.2 | L | Low | `package.json`, `core/mcp/*`, verification scripts |
| B | T5.3 | S | Low | `README.md` |
