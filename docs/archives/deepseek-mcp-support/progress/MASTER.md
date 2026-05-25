## DeepSeek++ MCP Support — Progress Tracker

> **Task**: Add MCP support to DeepSeek++ across browser HTTP/SSE/Streamable HTTP, local bridge/native messaging adapters for stdio-backed servers, automatic tool execution, and automation compatibility.
> **Started**: 2026-05-21
> **Last Updated**: 2026-05-22
> **Mode**: GITHUB_STANDARD
> **Repo**: zhu1090093659/deepseek-pp

## GitHub Resources

- **All MCP Issues**: `gh issue list -R zhu1090093659/deepseek-pp --label "spec:mcp" --state all`
- **Project Board**: Not created because tracking mode is `GITHUB_STANDARD`, not `GITHUB_FULL`.

## References

- [Project Overview](../analysis/project-overview.md)
- [Module Inventory](../analysis/module-inventory.md)
- [Risk Assessment](../analysis/risk-assessment.md)
- [Task Breakdown](../plan/task-breakdown.md)
- [Dependency Graph](../plan/dependency-graph.md)
- [Milestones](../plan/milestones.md)

## Milestones

| Phase | Name | Milestone URL | Open | Closed | Total |
|:--|:--|:--|--:|--:|--:|
| 1 | MCP Tool Platform Refactor | https://github.com/zhu1090093659/deepseek-pp/milestone/6 | 0 | 4 | 4 |
| 2 | MCP Transport And Server Registry | https://github.com/zhu1090093659/deepseek-pp/milestone/7 | 0 | 5 | 5 |
| 3 | Chat And Automation MCP Execution | https://github.com/zhu1090093659/deepseek-pp/milestone/8 | 0 | 5 | 5 |
| 4 | MCP Sidepanel And Permissions | https://github.com/zhu1090093659/deepseek-pp/milestone/9 | 0 | 4 | 4 |
| 5 | Verification And Documentation | https://github.com/zhu1090093659/deepseek-pp/milestone/10 | 0 | 3 | 3 |

## Issue Mapping

| Task ID | Issue | Title | Status |
|:--|:--|:--|:--|
| T1.1 | #18 | Define provider-neutral tool contracts | closed |
| T1.2 | #19 | Refactor memory tools into a local provider | closed |
| T1.3 | #20 | Make XML parsing and stream filtering descriptor-driven | closed |
| T1.4 | #21 | Add shared prompt augmentation service for chat and automation | closed |
| T2.1 | #22 | Add MCP server config store and secret policy | closed |
| T2.2 | #23 | Implement MCP protocol core | closed |
| T2.3 | #24 | Add browser HTTP SSE Streamable HTTP transports | closed |
| T2.4 | #25 | Add stdio bridge and native messaging adapters | closed |
| T2.5 | #26 | Add discovery cache health checks timeouts and result caps | closed |
| T3.1 | #27 | Add background tool registry and MCP runtime messages | closed |
| T3.2 | #28 | Sync dynamic tool descriptors into main-world hook | closed |
| T3.3 | #29 | Implement automatic MCP result continuation for manual chats | closed |
| T3.4 | #30 | Implement automation MCP execution loop | closed |
| T3.5 | #31 | Persist MCP call history and restore result blocks | closed |
| T4.1 | #32 | Add MCP sidepanel tab and server list detail views | closed |
| T4.2 | #33 | Add server editor for all supported transports | closed |
| T4.3 | #34 | Add discovered tool management and automatic execution defaults | closed |
| T4.4 | #35 | Add connection testing permission prompts and call result states | closed |
| T5.1 | #36 | Add compile-time and pure MCP smoke checks | closed |
| T5.2 | #37 | Run live verification with mock MCP and automation | closed |
| T5.3 | #38 | Update README and operator notes | closed |

## Quick Status Commands

```bash
# Phase progress for MCP milestones
gh api 'repos/zhu1090093659/deepseek-pp/milestones?state=all&per_page=100' --jq '.[] | select(.title|contains("MCP") or .title=="Phase 5: Verification And Documentation") | "\(.title): \(.open_issues) open, \(.closed_issues) closed"'

# Open MCP tasks
gh issue list -R zhu1090093659/deepseek-pp --label "spec:mcp" --state open --json number,title,milestone,labels

# Active Phase 1 tasks
gh issue list -R zhu1090093659/deepseek-pp --milestone "Phase 1: MCP Tool Platform Refactor" --state open --json number,title,labels
```

## Phase Checklist

- [x] Phase 1: MCP Tool Platform Refactor (4/4 tasks) - https://github.com/zhu1090093659/deepseek-pp/milestone/6
- [x] Phase 2: MCP Transport And Server Registry (5/5 tasks) - https://github.com/zhu1090093659/deepseek-pp/milestone/7
- [x] Phase 3: Chat And Automation MCP Execution (5/5 tasks) - https://github.com/zhu1090093659/deepseek-pp/milestone/8
- [x] Phase 4: MCP Sidepanel And Permissions (4/4 tasks) - https://github.com/zhu1090093659/deepseek-pp/milestone/9
- [x] Phase 5: Verification And Documentation (3/3 tasks) - https://github.com/zhu1090093659/deepseek-pp/milestone/10

## Execution Telemetry

- Per-task execution telemetry should be recorded in the corresponding GitHub Issue comments.
- Drift state lives in GitHub Milestone descriptions under the `adaptive` YAML block.
- Before closing any task, record actual effort, S.U.P.E.R score, and unplanned dependency count.

## Current Status

**Active Phase**: Complete

**Active Task**: None

**Blockers**: None

## Next Steps

1. Reload the unpacked extension from `dist/chrome-mv3/` before browser-side manual verification.
2. Use `node scripts/mcp-live-mock.mjs --serve` for a local MCP server when testing the sidepanel manually.
3. Keep future MCP changes covered by `npm run smoke:mcp` and `npm run verify:mcp:mock`.

## Session Log

| Date | Session | Summary |
|:--|:--|:--|
| 2026-05-21 | Planning | Archived completed DeepSeek automation spec, analyzed MCP integration risks, confirmed full-scope MCP target, generated plan docs, created GitHub labels/milestones/Issues #18-#38, and initialized progress tracking. |
| 2026-05-21 | T1.1 | Added provider-neutral tool contracts in `core/tool/*`, bridged them through `core/types.ts`, verified `npm run compile` and `npm run build`, recorded telemetry, and closed Issue #18. |
| 2026-05-21 | T1.2 | Moved memory tool execution behind the local provider adapter, preserved existing memory XML/result behavior, verified `npm run compile` and `npm run build`, recorded telemetry, and closed Issue #19. |
| 2026-05-21 | T1.3 | Added descriptor-driven XML parsing and stream/history filtering, enabled runtime tool descriptor sync into the main-world hook, verified `npm run compile` and `npm run build`, recorded telemetry, and closed Issue #20. |
| 2026-05-21 | T1.4 | Added shared prompt augmentation in `core/prompt`, moved manual chat and automation onto the same tool schema renderer, verified `npm run compile` and `npm run build`, recorded telemetry, closed Issue #21, and closed Phase 1 milestone #6. |
| 2026-05-21 | T2.1 | Added versioned MCP server config types/store with secret redaction, background CRUD messages, verified `npm run compile` and `npm run build`, recorded telemetry, and closed Issue #22. |
| 2026-05-21 | T2.2 | Added transport-agnostic MCP protocol client, initialize/list/call helpers, MCP tool descriptor/result normalization, verified `npm run compile` and `npm run build`, recorded telemetry, and closed Issue #23. |
| 2026-05-21 | T2.3 | Added browser HTTP, Streamable HTTP, and legacy SSE MCP transports with per-origin permission handling, bounded transport errors, verified `npm run compile` and `npm run build`, recorded telemetry, and closed Issue #24. |
| 2026-05-21 | T2.4 | Added stdio bridge and native messaging MCP transports, wired transport factory and nativeMessaging permission, verified `npm run compile` and `npm run build`, recorded telemetry, and closed Issue #25. |
| 2026-05-21 | T2.5 | Added MCP discovery cache, health records, refreshable cache actions, bounded timeout/result-cap execution path, verified `npm run compile` and `npm run build`, recorded telemetry, closed Issue #26, and closed Phase 2 milestone #7. |
| 2026-05-21 | T3.1 | Added background tool registry/runtime messages for descriptors, refresh, execution, and call history, verified `npm run compile` and `npm run build`, recorded telemetry, and closed Issue #27. |
| 2026-05-21 | T3.2 | Synced dynamic tool descriptors into content/main-world state, routed tool execution through background runtime, verified `npm run compile` and `npm run build`, recorded telemetry, and closed Issue #28. |
| 2026-05-21 | T3.3 | Added bounded manual-chat MCP result continuation with same-session follow-up prompts, preserved visible result blocks, verified `npm run compile` and `npm run build`, recorded telemetry, and closed Issue #29. |
| 2026-05-21 | T3.4 | Added automation MCP execution/continuation loop with dynamic descriptors and run-result tool summaries, verified `npm run compile` and `npm run build`, recorded telemetry, and closed Issue #30. |
| 2026-05-21 | T3.5 | Added bounded MCP execution summary persistence for refresh restore, automation run summaries, and tool history, verified `npm run compile` and `npm run build`, recorded telemetry, closed Issue #31, and closed Phase 3 milestone #8. |
| 2026-05-21 | T4.1 | Added MCP sidepanel navigation, server list/detail views, empty/loading/error states, verified `npm run compile` and `npm run build`, recorded telemetry, and closed Issue #32. |
| 2026-05-21 | T4.2 | Added MCP server editor for Streamable HTTP, HTTP, SSE, stdio bridge, and native messaging transports with validation and round-trip persistence, verified `npm run compile` and `npm run build`, recorded telemetry, and closed Issue #33. |
| 2026-05-21 | T4.3 | Added discovered tool management, visible default auto-execution policy, per-tool enable/disable allowlist behavior, and prompt-injection filtering for disabled/manual tools, verified `npm run compile` and `npm run build`, recorded telemetry, and closed Issue #34. |
| 2026-05-21 | T4.4 | Added MCP host permission requests, connection test actions, structured latency/error states, and recent MCP call status in the sidepanel, verified `npm run compile` and `npm run build`, recorded telemetry, closed Issue #35, and closed Phase 4 milestone #9. |
| 2026-05-21 | T5.1 | Added `npm run smoke:mcp` with mock MCP discovery/call flows, descriptor rendering, XML parsing/filtering, and timeout coverage, verified `npm run smoke:mcp`, `npm run compile`, and `npm run build`, recorded telemetry, and closed Issue #36. |
| 2026-05-21 | T5.2 | Added `npm run verify:mcp:mock` live loopback verification for manual and automation MCP continuations, documented browser/login policy limits in `docs/verification/mcp-live-mock.md`, verified full command set, recorded telemetry, and closed Issue #37. |
| 2026-05-21 | T5.3 | Updated README, MCP operator notes, verification docs, and progress tracker with supported transports, setup, limits, reload requirements, and troubleshooting; verified full command set, recorded telemetry, closed Issue #38, and closed Phase 5 milestone #10. |
| 2026-05-22 | Browser bugfix | Guarded content-script runtime and storage calls, runtime-id probes, async page-message handlers, unhandled rejection events, and WXT's bundled `wxt/browser` runtime proxy against Chrome extension reload invalidation, so stale DeepSeek tabs no longer surface uncaught `Extension context invalidated` Promise errors after reloading the unpacked extension. |
