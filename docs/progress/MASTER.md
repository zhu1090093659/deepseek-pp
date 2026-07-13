# DeepSeek++ Reliability and Compatibility Refactor — Progress Tracker

> **Task**: Refactor the extension, Shell Host, sync, persistence, and automation for higher performance, stability, compatibility, maintainability, and backward compatibility.
> **Started**: 2026-07-13
> **Last Updated**: 2026-07-13
> **Mode**: GITHUB_STANDARD
> **Repo**: `zhu1090093659/deepseek-pp`
> **Run ID**: `core-refactor-2026-07`

## GitHub Resources

- **Project Board**: Not used in `GITHUB_STANDARD` mode.
- **Run labels**: `spec-driven` + `spec:core-refactor-2026-07`
- **Issue range**: [#311](https://github.com/zhu1090093659/deepseek-pp/issues/311) through [#336](https://github.com/zhu1090093659/deepseek-pp/issues/336)
- **Task state authority**: GitHub Issues; this file is the local continuity index.
- **Adaptive state authority**: Each GitHub Milestone description; task telemetry is recorded in Issue comments before closure.

## References

- [Project Overview](../analysis/project-overview.md)
- [Module Inventory](../analysis/module-inventory.md)
- [Risk Assessment](../analysis/risk-assessment.md)
- [Compatibility Contract Registry](../compatibility/README.md)
- [Task Breakdown](../plan/task-breakdown.md)
- [Dependency Graph](../plan/dependency-graph.md)
- [Milestones](../plan/milestones.md)
- [Governance Resolution](./governance-resolution.md)

## Milestones

| Phase | Name | Milestone URL | Open | Closed | Total |
|:--:|:--|:--|--:|--:|--:|
| 1 | Compatibility Firewall | [#43](https://github.com/zhu1090093659/deepseek-pp/milestone/43) | 4 | 1 | 5 |
| 2 | Critical Boundaries and Failure Safety | [#44](https://github.com/zhu1090093659/deepseek-pp/milestone/44) | 6 | 0 | 6 |
| 3 | Authoritative Contracts and Real Ports | [#45](https://github.com/zhu1090093659/deepseek-pp/milestone/45) | 5 | 0 | 5 |
| 4 | Strangler Cutover of Runtime Hotspots | [#46](https://github.com/zhu1090093659/deepseek-pp/milestone/46) | 5 | 0 | 5 |
| 5 | Stability and Compatibility Closure | [#47](https://github.com/zhu1090093659/deepseek-pp/milestone/47) | 2 | 0 | 2 |
| 6 | Measured Performance Optimization | [#48](https://github.com/zhu1090093659/deepseek-pp/milestone/48) | 3 | 0 | 3 |

## Issue Mapping

| Task ID | Issue | Title | Status |
|:--|:--|:--|:--|
| T1.1 | [#311](https://github.com/zhu1090093659/deepseek-pp/issues/311) | Establish compatibility contract registry | closed |
| T1.2 | [#312](https://github.com/zhu1090093659/deepseek-pp/issues/312) | Freeze prompt, tool XML, and inline-agent output | open |
| T1.3 | [#313](https://github.com/zhu1090093659/deepseek-pp/issues/313) | Freeze runtime, bridge, tool, and sandbox contracts | open |
| T1.4 | [#314](https://github.com/zhu1090093659/deepseek-pp/issues/314) | Freeze persistence and sync compatibility fixtures | open |
| T1.5 | [#315](https://github.com/zhu1090093659/deepseek-pp/issues/315) | Freeze external runtime capability contracts | open |
| T2.1 | [#316](https://github.com/zhu1090093659/deepseek-pp/issues/316) | Harden extension runtime message boundary | open |
| T2.2 | [#317](https://github.com/zhu1090093659/deepseek-pp/issues/317) | Bind tool execution authorization context | open |
| T2.3 | [#318](https://github.com/zhu1090093659/deepseek-pp/issues/318) | Minimize Android WebView native bridge | open |
| T2.4 | [#319](https://github.com/zhu1090093659/deepseek-pp/issues/319) | Make sync uploads generation-atomic | open |
| T2.5 | [#320](https://github.com/zhu1090093659/deepseek-pp/issues/320) | Add staged sync download, journal, and rollback | open |
| T2.6 | [#321](https://github.com/zhu1090093659/deepseek-pp/issues/321) | Propagate automation cancellation, lease, and idempotency | open |
| T3.1 | [#322](https://github.com/zhu1090093659/deepseek-pp/issues/322) | Establish exhaustive runtime command map and handler port | open |
| T3.2 | [#323](https://github.com/zhu1090093659/deepseek-pp/issues/323) | Adopt narrow platform ports with real consumers | open |
| T3.3 | [#324](https://github.com/zhu1090093659/deepseek-pp/issues/324) | Version persistence codecs, repositories, and transaction boundary | open |
| T3.4 | [#325](https://github.com/zhu1090093659/deepseek-pp/issues/325) | Separate DeepSeek protocol, network policy, and page adapter | open |
| T3.5 | [#326](https://github.com/zhu1090093659/deepseek-pp/issues/326) | Replace hard-coded tool dispatch and split contract cycles | open |
| T4.1 | [#327](https://github.com/zhu1090093659/deepseek-pp/issues/327) | Migrate background to domain handlers and a composition root | open |
| T4.2 | [#328](https://github.com/zhu1090093659/deepseek-pp/issues/328) | Migrate content to a lifecycle kernel and capability controllers | open |
| T4.3 | [#329](https://github.com/zhu1090093659/deepseek-pp/issues/329) | Define floating-chat permission and lifecycle state machine | open |
| T4.4 | [#330](https://github.com/zhu1090093659/deepseek-pp/issues/330) | Extract Side Panel runtime client and domain controllers | open |
| T4.5 | [#331](https://github.com/zhu1090093659/deepseek-pp/issues/331) | Split Shell Host by protocol, router, and provider | open |
| T5.1 | [#332](https://github.com/zhu1090093659/deepseek-pp/issues/332) | Make migrated failure semantics observable | open |
| T5.2 | [#333](https://github.com/zhu1090093659/deepseek-pp/issues/333) | Remove legacy paths and close compatibility | open |
| T6.1 | [#334](https://github.com/zhu1090093659/deepseek-pp/issues/334) | Optimize content observers, polling, and teardown | open |
| T6.2 | [#335](https://github.com/zhu1090093659/deepseek-pp/issues/335) | Lazy-initialize Pyodide, bundled Skills, and heavy chunks | open |
| T6.3 | [#336](https://github.com/zhu1090093659/deepseek-pp/issues/336) | Reduce persistence write amplification and concurrent overwrite | open |

## Quick Status Commands

```bash
# All tasks in this run
gh issue list -R zhu1090093659/deepseek-pp \
  --label spec-driven \
  --label spec:core-refactor-2026-07 \
  --state all \
  --json number,title,state,milestone

# Milestone progress and adaptive state
gh api 'repos/zhu1090093659/deepseek-pp/milestones?state=all&per_page=100' \
  --jq '.[] | select(.title | startswith("[core-refactor-2026-07]")) | {number,title,open_issues,closed_issues,description}'

# Open Phase 1 tasks
gh issue list -R zhu1090093659/deepseek-pp \
  --milestone '[core-refactor-2026-07] Phase 1: Compatibility Firewall' \
  --state open \
  --json number,title
```

## Phase Checklist

- [ ] Phase 1: Compatibility Firewall (1/5 tasks) — [milestone](https://github.com/zhu1090093659/deepseek-pp/milestone/43)
- [ ] Phase 2: Critical Boundaries and Failure Safety (0/6 tasks) — [milestone](https://github.com/zhu1090093659/deepseek-pp/milestone/44)
- [ ] Phase 3: Authoritative Contracts and Real Ports (0/5 tasks) — [milestone](https://github.com/zhu1090093659/deepseek-pp/milestone/45)
- [ ] Phase 4: Strangler Cutover of Runtime Hotspots (0/5 tasks) — [milestone](https://github.com/zhu1090093659/deepseek-pp/milestone/46)
- [ ] Phase 5: Stability and Compatibility Closure (0/2 tasks) — [milestone](https://github.com/zhu1090093659/deepseek-pp/milestone/47)
- [ ] Phase 6: Measured Performance Optimization (0/3 tasks) — [milestone](https://github.com/zhu1090093659/deepseek-pp/milestone/48)

## Current Status

**Active Phase**: Phase 1 — Compatibility Firewall (in progress)

**Active Task**: T1.2 / [Issue #312](https://github.com/zhu1090093659/deepseek-pp/issues/312) — Freeze prompt, tool XML, and inline-agent output.

**Execution Branch**: `codex/312-prompt-output-freeze`

**Blockers**: None for Phase 1. The current working tree contains user-owned floating-chat compatibility changes; they are an overlap guard for T4.3, not a blocker for earlier phases.

**Baseline Evidence**: 63 test files / 359 tests, compile, prompt freeze, Chrome/Edge/Firefox builds, manifest policy, UTF-8 policy, and production audit passed on the 2026-07-13 working tree. Android runtime validation was unavailable because this machine lacked JDK/Gradle.

**T1.1 Evidence**:

- Registered 91 stable contract rows plus the exact 119 live / 89 declared runtime command-name inventories.
- Enumerated 35 fixed local-storage keys, one session-storage key, two IndexedDB identities, six sync files, import/export formats, browser manifests/capabilities, DeepSeek protocols, MCP, Shell and Multimodal Native Hosts, and the Android minimum contract.
- Relative registry links, unique stable IDs, runtime `119/89/32/2` set differences, repository script names, and root `CLAUDE.md` absence were checked from the isolated worktree.
- Final checks passed: TypeScript compile, prompt source freeze (10 cases), Chrome/Edge/Firefox builds, manifest policy, and extension UTF-8/ASCII policy. Read-only contract reviews also passed targeted prompt/runtime (7 files / 34 tests), persistence (14 / 88), and platform/integration (15 / 106) suites with hard 60-second timeouts and no orphan test/smoke processes.
- No production or test source file changed in T1.1; unresolved unsafe behavior is marked `Gap` or `Preserve + Gap`, not frozen as successful compatibility.

**T1.2 Evidence**:

- Replaced ten source-snippet hashes with four raw UTF-8 golden files generated from production prompt, request-augmentation, MCP normalization, XML-tag, and inline-agent functions.
- Covered composed memory/Skill/preset/project context, MCP and Shell descriptors, English thinking and Chinese chat prompts, XML aliases and 8/9-space boundaries, inline continuation/nudge output, prompt truncation, the hidden placeholder, and one-shot externalized-payload mismatch deletion.
- `npm run prompt:freeze` is read-only, has a 60-second hard timeout, and reports readable line diffs; updates require the explicit `npm run prompt:freeze:update` command.
- A deliberate golden drift was rejected with the expected focused line diff, then the reviewed fixture was regenerated explicitly; no production output changed.
- Targeted validation passed 9 files / 46 tests; the full clean-worktree suite passed 63 files / 363 tests, TypeScript compile passed, and no Vitest/Vite child process remained.

## Governance Status

**Shared instruction surface**: `AGENTS.md` — canonical and directly maintained.

**Claude Code instruction surface**: unavailable / not used; root `CLAUDE.md` is absent and must not be restored as a parallel truth source.

**Other platform rule surfaces**: none. `.claude/settings.local.json` is local permission configuration only.

**Memory surface**: unavailable; no repo fallback approved or created.

**Memory fallback path**: none.

## Adaptive Control

- Strategy: `compatibility-firewall + risk-first vertical slices + strangler cutover`.
- Milestone descriptions contain `drift_score`, thresholds, total/completed tasks, and last update time.
- Each completed Issue receives execution telemetry before the PR closes it.
- Threshold actions follow the spec-driven adaptive-control protocol: annotate, halt and replan, or halt and return for scope confirmation.

## Next Steps

1. Open and verify the Issue #312 PR with the completed byte-level compatibility evidence.
2. Record execution telemetry and update Milestone #43 after required PR checks pass.
3. Merge T1.2, then advance to the next independent Phase 1 compatibility-fixture lane.

## Session Log

| Date | Session | Summary |
|:--|:--|:--|
| 2026-07-13 | Analysis and planning | Completed repository analysis and baseline validation; confirmed scope and governance; generated 6 phases / 26 tasks; created Milestones #43-#48 and Issues #311-#336; converted `AGENTS.md` to the canonical Codex-first instruction surface. |
| 2026-07-13 | Phase 1 execution start | Verified local/remote main at `165ec46`, opened isolated branch `codex/311-compatibility-registry`, and started T1.1 / Issue #311. |
| 2026-07-13 | T1.1 implementation | Built the compatibility registry and runtime-command annex, completed three independent source reviews, corrected mixed Preserve/Gap semantics, and passed the documentation/static/build acceptance checks. |
| 2026-07-13 | T1.1 closure | Merged PR #337 at `48c6a00`, closed Issue #311, recorded task telemetry, and advanced Milestone #43 to 1/5 completed with zero cumulative drift. |
| 2026-07-13 | T1.2 execution start | Opened isolated branch `codex/312-prompt-output-freeze` from `48c6a00` and started byte-level output characterization for Issue #312. |
| 2026-07-13 | T1.2 implementation | Replaced source hashes with explicit raw UTF-8 goldens, froze XML/inline gaps without changing production output, and passed targeted, full-suite, compile, drift-diff, and orphan-process checks. |
