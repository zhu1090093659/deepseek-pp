# DeepSeek++ Reliability and Compatibility Refactor — Progress Tracker

> **Task**: Refactor the extension, Shell Host, sync, persistence, and automation for higher performance, stability, compatibility, maintainability, and backward compatibility.
> **Started**: 2026-07-13
> **Last Updated**: 2026-07-14
> **Mode**: GITHUB_STANDARD
> **Repo**: `zhu1090093659/deepseek-pp`
> **Run ID**: `core-refactor-2026-07`

## GitHub Resources

- **Project Board**: Not used in `GITHUB_STANDARD` mode.
- **Run labels**: `spec-driven` + `spec:core-refactor-2026-07`
- **Issue range**: completed/superseded history [#311](https://github.com/zhu1090093659/deepseek-pp/issues/311)–[#345](https://github.com/zhu1090093659/deepseek-pp/issues/345); replanned active work [#351](https://github.com/zhu1090093659/deepseek-pp/issues/351)–[#380](https://github.com/zhu1090093659/deepseek-pp/issues/380)
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

| Phase | Name | Milestone URL | Active Open | Completed | Superseded | Active Total |
|:--:|:--|:--|--:|--:|--:|--:|
| 1 | Compatibility Firewall | [#43](https://github.com/zhu1090093659/deepseek-pp/milestone/43) | 0 | 5 | 0 | 5 |
| 2 | Critical Boundaries and Failure Safety | [#44](https://github.com/zhu1090093659/deepseek-pp/milestone/44) | 0 | 7 | 0 | 7 |
| 3 | Authoritative Contracts and Real Ports | [#45](https://github.com/zhu1090093659/deepseek-pp/milestone/45) | 2 | 8 | 5 | 10 |
| 4 | Strangler Cutover of Runtime Hotspots | [#46](https://github.com/zhu1090093659/deepseek-pp/milestone/46) | 13 | 0 | 5 | 13 |
| 5 | Stability and Compatibility Closure | [#47](https://github.com/zhu1090093659/deepseek-pp/milestone/47) | 2 | 0 | 2 | 2 |
| 6 | Measured Performance Optimization | [#48](https://github.com/zhu1090093659/deepseek-pp/milestone/48) | 5 | 0 | 3 | 5 |

## Issue Mapping

| Task ID | Issue | Title | Status |
|:--|:--|:--|:--|
| T1.1 | [#311](https://github.com/zhu1090093659/deepseek-pp/issues/311) | Establish compatibility contract registry | closed |
| T1.2 | [#312](https://github.com/zhu1090093659/deepseek-pp/issues/312) | Freeze prompt, tool XML, and inline-agent output | closed |
| T1.3 | [#313](https://github.com/zhu1090093659/deepseek-pp/issues/313) | Freeze runtime, bridge, tool, and sandbox contracts | closed |
| T1.4 | [#314](https://github.com/zhu1090093659/deepseek-pp/issues/314) | Freeze persistence and sync compatibility fixtures | closed |
| T1.5 | [#315](https://github.com/zhu1090093659/deepseek-pp/issues/315) | Freeze external runtime capability contracts | closed |
| T2.1 | [#316](https://github.com/zhu1090093659/deepseek-pp/issues/316) | Harden extension runtime message boundary | closed |
| T2.2 | [#317](https://github.com/zhu1090093659/deepseek-pp/issues/317) | Bind tool execution authorization context | closed |
| T2.3 | [#318](https://github.com/zhu1090093659/deepseek-pp/issues/318) | Minimize Android WebView native bridge | closed; superseded by T2.3A |
| T2.3A | [#345](https://github.com/zhu1090093659/deepseek-pp/issues/345) | Remove Android template and support surface | closed |
| T2.4 | [#319](https://github.com/zhu1090093659/deepseek-pp/issues/319) | Make sync uploads generation-atomic | closed |
| T2.5 | [#320](https://github.com/zhu1090093659/deepseek-pp/issues/320) | Add staged sync download, journal, and rollback | closed |
| T2.6 | [#321](https://github.com/zhu1090093659/deepseek-pp/issues/321) | Propagate automation cancellation, lease, and idempotency | closed |
| T3.1–T6.3 (old) | [#322](https://github.com/zhu1090093659/deepseek-pp/issues/322) through #336 | Original remaining decomposition | closed; `superseded-by-replan`, each Issue links replacements |
| R3.1 | [#351](https://github.com/zhu1090093659/deepseek-pp/issues/351) | Create typed handler seam and migrate the two bootstrap commands | closed |
| R3.2 | [#352](https://github.com/zhu1090093659/deepseek-pp/issues/352) | Cut over tool contracts and provider registry | closed |
| R3.3 | [#353](https://github.com/zhu1090093659/deepseek-pp/issues/353) | Extract active DeepSeek protocol and network-policy core | closed |
| R3.4 | [#354](https://github.com/zhu1090093659/deepseek-pp/issues/354) | Reuse DeepSeek codecs in passive interceptor adapters | closed |
| R3.5 | [#355](https://github.com/zhu1090093659/deepseek-pp/issues/355) | Version Project, Saved Items, and Scenario repositories | closed |
| R3.6 | [#356](https://github.com/zhu1090093659/deepseek-pp/issues/356) | Converge Memory and Artifact IndexedDB truth | closed |
| R3.7 | [#357](https://github.com/zhu1090093659/deepseek-pp/issues/357) | Serialize sync config/actions and fence confirmed targets | closed |
| R3.8 | [#358](https://github.com/zhu1090093659/deepseek-pp/issues/358) | Version Automation state and own Usage/Tool History mutations | closed |
| R3.9 | [#359](https://github.com/zhu1090093659/deepseek-pp/issues/359) | Remove dead platform facade and preserve PC capability truth | open |
| R3.10 | [#380](https://github.com/zhu1090093659/deepseek-pp/issues/380) | Version remaining Skill/Preset/History local state and cross-key mutations | open |
| R4.1 | [#360](https://github.com/zhu1090093659/deepseek-pp/issues/360) | Extract Background persistence and library handlers | open |
| R4.2 | [#361](https://github.com/zhu1090093659/deepseek-pp/issues/361) | Extract Background MCP, tool, and browser-control handlers | open |
| R4.3 | [#362](https://github.com/zhu1090093659/deepseek-pp/issues/362) | Extract Background DeepSeek, chat, multimodal, and export handlers | open |
| R4.4 | [#363](https://github.com/zhu1090093659/deepseek-pp/issues/363) | Close Background sync, automation, usage, scenario, and lifecycle root | open |
| R4.5 | [#364](https://github.com/zhu1090093659/deepseek-pp/issues/364) | Build Content lifecycle kernel and bridge controller | open |
| R4.6 | [#365](https://github.com/zhu1090093659/deepseek-pp/issues/365) | Extract Content tool, inline-agent, and chat controllers | open |
| R4.7 | [#366](https://github.com/zhu1090093659/deepseek-pp/issues/366) | Extract remaining Content DOM capability controllers | open |
| R4.8 | [#367](https://github.com/zhu1090093659/deepseek-pp/issues/367) | Model floating-chat permission and lifecycle state | open |
| R4.9 | [#368](https://github.com/zhu1090093659/deepseek-pp/issues/368) | Extract Side Panel typed runtime client and async-state core | open |
| R4.10 | [#369](https://github.com/zhu1090093659/deepseek-pp/issues/369) | Move Side Panel MCP and Tools policy into controllers | open |
| R4.11 | [#370](https://github.com/zhu1090093659/deepseek-pp/issues/370) | Move Side Panel Chat, Settings, and Library policy into controllers | open |
| R4.12 | [#371](https://github.com/zhu1090093659/deepseek-pp/issues/371) | Split Shell Host framing, router, and session/process providers | open |
| R4.13 | [#372](https://github.com/zhu1090093659/deepseek-pp/issues/372) | Split Shell file, Skill, picker, OS adapters, and installer | open |
| R5.1 | [#373](https://github.com/zhu1090093659/deepseek-pp/issues/373) | Audit changed-path failure, legacy, cycle, and second-truth gaps | open |
| R5.2 | [#374](https://github.com/zhu1090093659/deepseek-pp/issues/374) | Close PC Chrome, Edge, and Firefox compatibility | open |
| R6.1 | [#375](https://github.com/zhu1090093659/deepseek-pp/issues/375) | Optimize Content observers, polling, and callback work | open |
| R6.2 | [#376](https://github.com/zhu1090093659/deepseek-pp/issues/376) | Audit packaged Pyodide cost and eliminate proven duplication | open |
| R6.3 | [#377](https://github.com/zhu1090093659/deepseek-pp/issues/377) | Load bundled Skill resources on demand | open |
| R6.4 | [#378](https://github.com/zhu1090093659/deepseek-pp/issues/378) | Split heavy Side Panel pages and chunks on demand | open |
| R6.5 | [#379](https://github.com/zhu1090093659/deepseek-pp/issues/379) | Coalesce persistence burst writes | open |

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

# Open replanned Phase 3 tasks
gh issue list -R zhu1090093659/deepseek-pp \
  --milestone '[core-refactor-2026-07] Phase 3: Authoritative Contracts and Real Ports' \
  --state open \
  --json number,title
```

## Phase Checklist

- [x] Phase 1: Compatibility Firewall (5/5 tasks) — [milestone](https://github.com/zhu1090093659/deepseek-pp/milestone/43)
- [x] Phase 2: Critical Boundaries and Failure Safety (7/7 tasks) — [milestone](https://github.com/zhu1090093659/deepseek-pp/milestone/44)
- [ ] Phase 3: Authoritative Contracts and Real Ports (8/10 replanned tasks) — [milestone](https://github.com/zhu1090093659/deepseek-pp/milestone/45)
- [ ] Phase 4: Strangler Cutover of Runtime Hotspots (0/13 replanned tasks) — [milestone](https://github.com/zhu1090093659/deepseek-pp/milestone/46)
- [ ] Phase 5: Stability and Compatibility Closure (0/2 tasks) — [milestone](https://github.com/zhu1090093659/deepseek-pp/milestone/47)
- [ ] Phase 6: Measured Performance Optimization (0/5 replanned tasks) — [milestone](https://github.com/zhu1090093659/deepseek-pp/milestone/48)

## Current Status

**Active Phase**: Phase 3 — Authoritative Contracts and Real Ports (replanned; implementation active)

**Active Task**: R3.9 / [Issue #359](https://github.com/zhu1090093659/deepseek-pp/issues/359) — remove the dead platform facade and preserve PC capability truth.

**Execution Branch**: `codex/359-platform-capability-truth` in isolated worktree `/Users/zcl/code/deepseek-pp-worktrees/359-platform-capability-truth`, based on `main@e56bb04`.

**Blockers**: None. Work is isolated from the original repository's user-owned changes.

**Baseline Evidence**: PC-only main is `e56bb04` after R3.8. R3.8 passed 118 files / 929 tests plus the full PC quality/package matrix; hosted quality and contribution-evidence runs `29305277568` / `29305277549` passed before PR #389 squash-merged at `e56bb04d9b5c3058cca85104455f63757f3cb864`. Milestone #45 is 8/10 with drift score 2, so #359 carries the Level 1 adaptive warning. Android project/build/runtime/test support remains retired.

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

**T1.3 Evidence**:

- Added an executable 121-entry runtime command registry tied to TypeScript-AST discovery of the 119 live handlers, 89 declared actions, payload access/presence, listener error families, 17 notifications, and three tab RPCs.
- Centralized the 13 bridge message names, sources, and handshake types, plus the seven sandbox envelope names, port identity, frame target, envelope parser, result normalizer, and boundary request normalizer used by real producers and consumers.
- Added legal and malformed fixtures for runtime requests/responses/errors, bridge traffic, tool wire records, and sandbox multi-hop traffic; permissive shallow envelopes and other unsafe accepted behavior were assigned to then-owners T2.1/T2.2/T3.1, with remaining handler-seam ownership now carried by R3.1 / #351.
- Preserved current legal behavior and error text while removing duplicated boundary normalization. Targeted validation passed 4 files / 71 tests; the full suite passed 66 files / 433 tests, compile, prompt freeze, and Chrome/Edge/Firefox builds passed, and no test child process remained.

**T1.4 Evidence**:

- Centralized the released Memory and Artifact database identities, schemas, retention limit, and legacy key in contract modules consumed by the production stores; centralized Project, Saved Items, Scenario, sync-config, and six remote sync keys without changing their values.
- Added raw fixtures for Memory v1-v3, Artifact legacy storage, released Project v1/v2, Saved Items legacy/v1/future, Scenario storage, and every required/optional sync JSON file.
- Executed Memory v1→v3 and v2→v3 upgrades, v3 project-scope reopen, and Artifact legacy migration through the production Dexie stores with fake IndexedDB. At the T1.4 freeze point, Project v1 reset, malformed Artifact filtering, Saved Items future-version downgrade, Scenario read fallback, and sync partial commits were assigned to then-owners T2.4/T2.5/T3.3; T2.4/T2.5 are closed and remaining persistence ownership is now R3.5 / #355, R3.6 / #356, and R3.10 / #380.
- Targeted validation passed 11 files / 49 tests; the full suite passed 69 files / 441 tests, TypeScript compile and prompt freeze passed, Chrome/Edge/Firefox builds passed, and no Vitest/WXT/TypeScript child process remained. Builds emitted only the existing Pyodide `node:*` externalization warnings.

**T1.5 Evidence**:

- Centralized all released DeepSeek Web/Official API route identities and the Native Messaging envelope identity in contract modules consumed by production adapters and transports; existing aliases remain available.
- Added executable DeepSeek/body/SSE, 15-key capability, MCP negotiation/transport/output, exact 12-tool Shell catalog/framing/installer, and Android-minimum fixtures. Unsafe substring matching, malformed/CRLF SSE, unknown MCP transport/version, shallow JSON-RPC, UTF-16 truncation, tool-count overshoot, installer partial state, and Android origin/bridge behavior remain labeled with T2-T5 owners.
- Strengthened generated Chrome/Edge/Firefox manifest assertions and made Android asset staging verify required inputs before replacing output. Existing unavailable/context-invalidated browser API degradation is now executable.
- Targeted validation passed 5 files / 34 tests; the full suite passed 74 files / 475 tests. Compile, prompt freeze, three browser builds, exact manifest and 84-file UTF-8 policy, production audit, PoW/MCP/mock/Shell smoke, and 35-file Android asset staging passed. Android APK/runtime validation remains unavailable because no usable JDK, Gradle, or wrapper is installed.

**T2.1 Evidence**:

- Added one runtime boundary that decodes the top-level envelope, constructs browser-owned sender/tab/frame/document context, derives document and DeepSeek route session identity, and authorizes the released 28-command DeepSeek content surface before the existing router. Extension-page behavior and the 119-case router remain intact.
- Restricted content tab RPC/notification receivers and the sandbox offscreen Port to this extension's generated Chrome/Edge service-worker or Firefox background-page path; invalid sender, inactive document, child frame, tab mismatch, malformed envelope, and unauthorized content command cases are executable.
- Replaced the shallow bridge validator with a direction-specific 13-type decoder, receiver-owned document session controller, and a reusable tool-record codec authority. Stale Port handlers have zero dispatch after pagehide/messageerror or replacement; BFCache opens a new epoch. Legal JSON records, MCP schema-valued `additionalProperties`, timeout behavior, and nullable captured headers remain compatible.
- Unified `RUN_ARTIFACT_CODE` and `sandbox_run` request normalization, including the 30,000 UTF-8-byte cap, before offscreen creation. Port/frame/HTML envelopes now require strict nested results, exact source/origin, and receiver-owned correlation; opaque sandbox `postMessage('*')` remains as an explicit compatibility policy.
- Shape-valid calls from the current bridge remain routing claims; descriptor/provider/mode/risk/call/session authorization, replay, and cross-session rejection are owned by T2.2 / Issue #317 rather than a second content-side authorization path.
- Full `npm run ci:quality` passed: 75 files / 527 tests, seven prompt goldens, compile, workflow/i18n/automation checks, zero high production vulnerabilities, MCP/live-mock/Shell/PoW smoke, Chrome/Edge/Firefox builds and packages, 84-file UTF-8 and manifest policy, and release-asset verification. The 60-second full-test run left no orphan Vitest/Vite process.

**T2.2 Evidence (closed)**:

- Added one background-owned authorization state for request, receiver-owned document/chat session, advertised descriptor/provider/mode/risk/schema digest, payload fingerprint, expiry, and atomic call reservation. New-chat grants bind once to their assigned chat; cross-document/session, stale, disabled, replayed, forged, and mismatched calls fail before tool-provider execution.
- Content now generates the authoritative request identity, returns a per-request descriptor catalog to MAIN, registers externalized tool work before awaiting payload writes, and revokes grants after request-scoped tasks settle on completion, cancel, abort, timeout, network failure, no-body response, bridge disconnect, or agent completion.
- Provider routing now selects MCP versus local before matching tool names; MCP execution requires the authorized descriptor. Production local-Skill imports inject the runtime executor instead of retaining a direct MCP default. The released `web_fetch` permission retry is limited to one identical-payload retry.
- Session storage uses strict version-1 nested decoding, compact SHA-256 schema and call digests, and enforced 32-grant / 128-call / 4 MiB limits. The first external-payload chunk persists its collection binding; later exact receiver-bound chunks use an expiry-bounded in-memory proof, with full persisted revalidation after a service-worker restart. Reservation writes fail closed; post-provider completion-write failures retain the replay barrier and preserve the real result/history with an explicit error.
- The bridge contract adds the additive `REQUEST_TERMINAL` event and request-owned augmentation metadata, moving the executable bridge inventory from 13 to 14 types. Prompt-visible tool ordering and legal `ToolCall`, `ToolResult`, history, and manual/high-risk mode semantics remain unchanged.
- Full `npm run ci:quality` passed: 83 files / 583 tests, seven prompt goldens, TypeScript compile, workflow/i18n/automation checks, zero high production vulnerabilities, MCP/live-mock/Shell/PoW smoke, Chrome/Edge/Firefox builds and packages, UTF-8/manifest policy, and release-asset verification. A separate 60-second full-test run passed, `git diff --check` is clean, and three independent contract reviews found no remaining blocker after the response-terminal, retry-state, provider-identity, and cache-expiry fixes. PR #343 merged at `279cb3e`; Issue #317 closed and Milestone #44 advanced to 2/6 with zero cumulative drift.

**T2.3 Evidence (closed; historical and superseded by T2.3A)**:

- Replaced four string-prefix trust decisions with one pure parsed scheme/host/effective-port policy used by intent loading, WebView navigation, source-origin checks, and bundle injection. External launch failure is fail-closed.
- Removed global `addJavascriptInterface` and all seven legacy public native methods. AndroidX WebKit 1.16.0 now provides an exact-origin WebMessage listener; callbacks require the trusted main frame and the bundle stays disabled when the feature is unavailable.
- Added strict protocol v1 decoding with one correlated async dispatcher, four native commands, three low-sensitivity UI preference keys, bounded atomic batches, stable errors, and an audited runtime subset. Removed arbitrary preferences, prompt/tool trace history, captured-header access, stale project context, raw error leakage, and the empty-file download mock.
- Added Android compatibility for T2.2's authorization lifecycle through bounded empty-descriptor grants while keeping tool execution, payload chunks, sandbox, MCP mutation, and browser parity unsupported.
- Strict JSON decoding rejects Android `org.json` extensions, trailing input, duplicate keys, and Unicode-escape-equivalent keys before platform parsing. Fake-store JVM tests cover storage atomicity/corruption and the bounded authorization lifecycle; three independent contract reviews report no remaining P0/P1/P2.
- Full local and hosted `npm run ci:quality` passed with 84 files / 592 tests, seven prompt goldens, TypeScript compile, workflow/i18n/automation checks, zero high production vulnerabilities, MCP/live-mock/Shell/PoW smoke, Chrome/Edge/Firefox builds and packages, UTF-8/manifest policy, and release-asset verification. The separate 60-second full suite passed, Android staging produced 35 files with a byte-identical shim, and no orphan Vitest/Gradle process remained.
- Local `testDebugUnitTest` fails explicitly because no JDK is installed. Hosted run `29254928324` compiled the Android app with aligned Java/Kotlin 17 targets and passed all 15 JVM tests; its repository quality job also passed. Two earlier Android runs exposed and drove removal of the JVM-target mismatch and platform-`org.json` assumptions rather than being bypassed.
- PR #344 merged at `6daa2a2946dd7aec9192e888d8b6323aca21ad55`; Issue #318 closed after telemetry was recorded, and Milestone #44 advanced to 3/6 with zero cumulative drift before the user changed the supported-platform scope.

**T2.3A Evidence (closed)**:

- User scope changed to PC Chrome/Edge/Firefox only. Issue #345 and isolated branch `codex/345-remove-android-template` were created; Milestone #44 was rescaled to seven tasks with one recorded scope drift.
- Android project, bridge/shim, build scripts, package commands, JVM CI job, and Android-specific tests/fixtures are removed. Platform detection now has one supported browser-extension kind and an explicit all-false `unknown` degradation path.
- `AGENTS.md`, public README files, compatibility registries, analysis, plan, and this tracker now state one PC-only product boundary while retaining historical release/progress evidence as superseded rather than rewriting history.
- Full `ci:quality` passed with 83 files / 580 tests, Chrome/Edge/Firefox builds and packages, source archive inspection, and no orphan test/Gradle process. PR #346 merged at `c3e68bd66681003b683f95888d5455f3033e81e2`; Issue #345 closed and hosted run `29257208567` passed.

**T2.4 Evidence (closed)**:

- Split the provider-agnostic `StorageBackend` port from the concrete composition factory, removing the sync provider dependency cycle while retaining the same WebDAV, Google Drive, and OneDrive implementations.
- New uploads serialize all six logical files, precompute SHA-256/UTF-8 byte metadata, stage generation-scoped payloads, write a schema-v1 manifest, and replace `sync-current.json` last. They never dual-write legacy fixed files.
- Readers use legacy fixed files only when the pointer is absent. A present pointer requires a valid manifest, exact six-file allowlist, generation identity, byte lengths, and checksums; corrupt/future/incomplete generations fail visibly before local mutation.
- Fault injection covers every payload/manifest/pointer write boundary, all-settled staging with provider error detail, lost pointer responses, commit-indeterminate verification, concurrent publishers, strict read failures, and newest-live Google Drive canonical-object selection that excludes trashed duplicates. T2.5 closes staged local apply and rollback; R3.7 now closes config/action serialization and confirmed-target overwrite, while committed-with-local-bookkeeping warning UX remains R4.11 / #370.
- Current validation passes 6 targeted files / 73 tests and the 60-second full suite at 84 files / 613 tests, plus TypeScript compile, prompt freeze, i18n, manifest/UTF-8 policy, Chrome/Edge/Firefox builds, `git diff --check`, and orphan-process checks. Three independent final reviews report no remaining merge blocker after provider error-detail, raw-fixture, lost-response, manifest-integrity, and GDrive duplicate-object corrections.
- PR #347 merged at `2928d85f5d0de361a98af461d5e54a566709d36f`; Issue #319 closed after telemetry, hosted quality and contribution-evidence runs passed, and Milestone #44 advanced to 5/7 with cumulative drift score 1.

**T2.5 Evidence (closed)**:

- Replaced parallel multi-store download mutation with a pure local-apply coordinator and production browser/IndexedDB ports. Remote generation/legacy reads, schema validation, local-import merge, occurrence-stable duplicate-`syncId` Memory-ID planning, and active-preset decisions finish before journal preparation.
- Added `DeepSeekPPSyncRecovery` v1 with singleton `journal/current`. The SHA-256-protected record stores raw Memory rows and opaque present/value preimages for Skills, Skill Sources, Presets, active preset, Project Context, and Saved Items; unknown/corrupt/future journals fail closed without deletion.
- Fixed-order target writes are committed only by deleting the journal. Every apply failure restores all stores in reverse order; incomplete rollback keeps the record for restart recovery. Lost prepare/clear responses are read back, and an unverifiable clear is reported as commit-indeterminate rather than guessed.
- Local Skill-import merge, sync apply/recovery, ordinary Memory/Skill/Preset/Project/Saved Items mutations, and project/Memory cascade deletion now share one non-reentrant local-state lock, while the coordinator calls explicit already-locked store primitives. Failed-apply recovery runs before lock release; if it remains incomplete, the lock is fail-closed and retries recovery before any queued write or second download can stage. Background recovery gates runtime dispatch, stale-Memory archival, and startup/alarm automation scans; transient durable-recovery failures are retried by the next dispatch, and post-recovery broadcast failure is reported without poisoning readiness.
- Exact rollback covers released raw Memory rows/IDs/unknown fields plus all affected raw key values/absence. IndexedDB cannot rewind its hidden `++id` generator, so a failed high-ID target can only make a future new ID skip forward; this has executable fake-IndexedDB evidence, loses no row/reference/retry identity, and remains an explicit `DB-001` gap owned by R3.6 / #356 rather than a silent compatibility claim.
- Targeted validation passes 14 files / 117 tests, including every target write's fail-before/commit-then-throw boundary, every recovery-write failure, queued mutation/download recovery ordering, all interrupted prefixes, corrupt/future/checksum journals, idempotent retry, executable raw journal fixture, raw missing-key restoration, occurrence-stable duplicate Memory IDs, and fake-IndexedDB reopen/generator evidence. The 60-second full suite passes 92 files / 671 tests; full `ci:quality` also passes prompt freeze, TypeScript, workflow/i18n/automation checks, zero high production vulnerabilities, MCP/live-mock/Shell/PoW smoke, Chrome/Edge/Firefox builds and packages, UTF-8/manifest policy, release assets, and `git diff --check`.
- PR #348 merged at `737c91f65d4a8f04c11cc55451748379ef903437`; Issue #320 closed after telemetry, hosted quality and contribution-evidence runs passed, and Milestone #44 advanced to 6/7 with cumulative drift score 2. The annotate threshold was reached, so Issue #321 carries the adaptive drift warning before T2.6 starts.

**T2.6 Evidence (closed)**:

- Replaced the timeout `Promise.race`/in-memory-only lock with one atomic persisted `running` claim plus an in-process execution lease. The scheduler aborts at the deadline but awaits the real executor settlement before releasing authority; terminal writes are fenced to the same still-running row.
- Added an execution context carrying run/automation IDs, persisted deadline, attempt, `AbortSignal`, current-lease assertion, and stable scoped idempotency keys. DeepSeek session/PoW/completion/history, automation continuation, runtime tools, web providers, MCP initialization/call, and cancellable transports receive the signal without changing released request bodies, headers, JSON-RPC IDs, commands, or UI. Concurrent PoW cold starts share one cancellable WASM load, while unconsumed web responses explicitly release their bodies.
- Scheduled runs use stable occurrence identity and also deduplicate historical random run IDs by `(automationId,scheduledFor)`. Fresh persisted rows block restart execution; expired rows close as non-retryable ambiguous failures and advance without replay. Only explicit `retrySafe:true` plus `externalOutcome:not_started` results may retry; post-dispatch and thrown failures are terminal.
- Store mutations are serialized in one authority; claim and finalization are atomic within the service worker. Historical runner requests without `deadlineAt` derive the released 180-second window from `requestedAt`. Deleting an automation first aborts the active context, while late executor output cannot recreate or overwrite deleted/terminal state.
- Final local validation passes targeted cancellation/MCP slices, TypeScript compile, and the 60-second full suite at 97 files / 710 tests. Full `ci:quality` also passes seven prompt goldens, workflow/i18n/automation checks, zero high production vulnerabilities, MCP/live-mock/Shell/PoW smoke, Chrome/Edge/Firefox builds and packages, UTF-8/manifest policy, and release-asset verification. Coverage includes timeout settlement, internal cancellation, stable retry keys, no ambiguous retry, scheduled occurrence dedupe, restart lease recovery, legacy deadline normalization, finalization fencing, shared cancellable PoW loading, web-response release, DeepSeek signal propagation, continuation cancellation, and MCP/Native cancellation. Independent final reviews report no P0/P1/P2 blocker.
- PR #350 passed hosted quality and contribution-evidence runs `29273029432` / `29273029933`, then squash-merged at `1b933d1fdbc5a5ec4d5c47b5911d0e50ca297324`; Issue #321 closed after telemetry. Milestone #44 completed 7/7 with cumulative drift score 3, triggering adaptive replanning before any Phase 3 implementation.

**R3.1 Evidence (closed)**:

- Added one production runtime-command ownership registry with exactly two typed bootstrap handlers, 119 transitional legacy cases, and two explicitly client-only notification names. Unknown and client-only dispatch returns stable `runtime_command_unknown`; typed failures cannot fall back to the legacy switch.
- Moved `GET_CONFIG` and `WHATS_NEW_DISMISSED` out of the switch into dependency-injected handlers, preserving exact success records, ignored request siblings, dismiss-before-badge ordering, and the listener's released `{ok:false,error}` projection. Their Side Panel callers now use the same compile-time request/success-response contracts.
- Promoted the 123-name contract metadata to the single production owner authority and updated AST/inventory checks to prove the frozen `121/91/89/32/2` and `77/44/71` topology, exclusive current `2/119/2` ownership, exclusive future `2/57/29/16/17` cutover ledger, migrated-case deletion, duplicate/missing/cross-owner rejection, serialization, unknown behavior, and bootstrap failure stages.
- Local validation passes the targeted 7-file / 61-test slice, TypeScript compile, and the 60-second full suite at 98 files / 726 tests with no orphan Vitest process. Prompt freeze, production audit, workflow/i18n/automation checks, MCP/live-mock/Shell/PoW smoke, Chrome/Edge/Firefox builds and packages, UTF-8/manifest policy, and release-asset verification also pass; builds emit only the existing Pyodide `node:*` externalization warnings.
- PR #382 merged at `16eec9a0dbea007a5b273ee65d450eafe7ebe659`; Issue #351 closed after telemetry and Milestone #45 advanced to 1/10 completed with zero cumulative drift.

**R3.2 Evidence (closed)**:

- Added one ordered production provider registry for Memory, Web, Artifact, Skill Creator, Memory Import, Browser Control, and MCP. Descriptor ownership, duplicate IDs/invocation names, exact local `in_process` transport, optional provider refresh, and provider-before-name execution routing are enforced in that authority; Background only composes it.
- Replaced permissive MCP storage normalization with a pure strict v1 codec. Released transports, secrets, allowlists, legacy cache collisions, and additive top-level fields survive legal reads/mutations; future/corrupt versions, duplicate/orphan identities, and unknown transports fail visibly before storage mutation, permission, UUID, notification, or provider/network action.
- Externalized payload parse errors now complete authorization/history without provider I/O. Content descriptor sync uses strict records and disables the catalog on initial, locale, broadcast, or refresh failure instead of retaining default tools. Unsupported MCP protocol versions fail before `notifications/initialized`; missing versions preserve the released fallback.
- Import-graph/SCC and AST composition checks prove that runtime/registry contracts do not import concrete providers and only the Background composition root constructs the registry. Prompt/XML ordering, grants, idempotency, history, visible results, and PC-only browser behavior remain frozen.
- Final local validation passes the targeted 11-file / 146-test contract slice and the 60-second full suite at 102 files / 764 tests with no orphan Vitest/Vite process. TypeScript compile, seven prompt goldens, workflow/i18n/automation checks, zero high production vulnerabilities, MCP/live-mock/Shell/PoW smoke, Chrome/Edge/Firefox builds, 84-file UTF-8 policy, manifest policy, and `git diff --check` pass; builds emit only the existing Pyodide `node:*` externalization warnings.
- Hosted quality and corrected contribution-evidence runs `29284787858` / `29284904063` passed. PR #383 squash-merged at `e8c83a81bd7ac6f1b8b01863f328baba324cd152`; Issue #352 closed after telemetry and Milestone #45 advanced to 2/10 completed with cumulative drift score 1.

**R3.3 Evidence (closed)**:

- Added one pure active route/request codec for all eight released Web paths, exact origin/path/method policy, frozen session/PoW/completion/history request bytes, model aliases, bypass header, and no DeepSeek idempotency field/header. Active automation, upload/file metadata, and conversation export session/history/file requests now consume this route authority; the passive substring matcher remains an explicit R3.4 gap.
- Moved the SSE implementation authority and token-speed metrics below `core/deepseek`; active Web and Official API clients share one incremental UTF-8 decoder/reducer, while passive interceptor imports are temporary compatibility re-exports for R3.4. Released text, fragment, batch, usage, message-id, and FINISHED shapes remain frozen; malformed JSON remains the R5.1 gap.
- Added one injected network policy used by active Web, Official API, and export requests. Scheduler-owned automation uses only its existing execution `AbortSignal`, while standalone client calls may supply an absolute deadline; the policy does not duplicate the automation timer or release the Phase 2 lease early, preserves caller abort reasons, waits for non-cooperative fetch and stream cancellation settlement, and cancels late bodies. Active Web and Official API requests use 4 MiB UTF-8 budgets; per-session conversation export has a separate 32 MiB response budget, and image input retains its separate 8 MiB contract.
- `runDeepSeekAutomation` now consumes a required narrow `DeepSeekAutomationClient` port instead of the 900-line compatibility adapter; the Background composition root injects the concrete client and tests inject the port rather than mocking a whole concrete module. Session/PoW/completion/history propagation, fresh-PoW continuation, stable tool idempotency, pre-dispatch safe retry, post-dispatch ambiguous failure, and history cancellation behavior remain green. Completion dispatch is marked only after body/deadline preflight and immediately before `fetch`, so rejected oversized requests remain `not_started`. The retired, unused content/window automation bridge constants, guards, and types were deleted.
- Targeted validation passes 10 files / 61 tests; TypeScript compile and the 60-second full suite pass at 105 files / 783 tests with no orphan Vitest/Vite process. Full `ci:quality` also passes seven prompt goldens, workflow/i18n/automation checks, zero high production vulnerabilities, MCP/live-mock/Shell/PoW smoke, Chrome/Edge/Firefox builds and packages, 84-file UTF-8 policy, manifest policy, and release-asset verification. New evidence covers exact routes/methods/headers/raw bodies, model aliases, split UTF-8 SSE, message IDs/usage, operation-specific budget boundaries, large per-session export compatibility, response-header and deferred stream cancellation, non-cooperative late fetch cleanup, semantic network phases, real Official API signal propagation, truthful pre/post-dispatch outcomes, and a production-client oversized PoW response that preserves its non-retryable policy error.
- Hosted quality and corrected contribution-evidence runs `29288282399` / `29288361106` passed. PR #384 squash-merged at `58cd05d96df6775ab234cc81f4bd4fd3bf584d43`; Issue #353 closed after telemetry and Milestone #45 advanced to 3/10 completed with cumulative drift score 1.

**R3.4 Evidence (closed)**:

- Replaced the permissive passive substring router with the shared exact Web route classifier. Fetch respects an explicit `RequestInit.method` over `Request.method`; XHR publishes tentative route/header state before native `open` can synchronously re-enter page handlers and restores the prior state if native `open` throws. Relative URLs resolve against the current document. Completion/regenerate require POST, history requires GET, and wrong-origin/query/suffix/method or non-string Web IDL inputs bypass extension logic without changing native behavior.
- Added one raw-preserving LF/CRLF SSE frame decoder consumed by active byte decoding and passive Fetch/XHR. Passive processing now parses each frame once, reuses the shared message-id/reducer authority, preserves unknown events/fields/comments and explicit separators when visible text is rewritten, retains the released LF delimiter for an unterminated final passive frame, and deletes the interceptor parser/token-metric facades and local message-id/framing implementations.
- Fetch and XHR share one passive response state for token metrics, tool accumulation, prompt cleanup, visible-stream filtering, and response-complete metadata. Fetch reads only on downstream pull, flushes split UTF-8 at EOF, waits for upstream reader cancellation before terminal notification, and suppresses late response/tool/token callbacks. XHR makes the final successful frame visible before pre-registered page load handlers, while abort/error/timeout publish one final inactive metric and never a false response completion.
- Targeted validation passes 11 files / 151 tests, including every UTF-8 byte split, every CRLF character split, request unknown siblings, unknown/modified raw frames, response metadata, cancellation settlement, reader failure, backpressure, XHR synchronous re-entry/open rollback/load ordering/network or native-send failure, bridge schemas, and token metrics. TypeScript compile and the 60-second full suite pass at 105 files / 798 tests with no orphan Vitest/Vite process. Full `ci:quality` also passes seven prompt goldens, workflow/i18n/automation checks, zero production vulnerabilities, MCP/live-mock/Shell/PoW smoke, Chrome/Edge/Firefox builds and packages, UTF-8/manifest policy, release-asset verification, and `git diff --check`; builds emit only the existing Pyodide `node:*` externalization warnings. Malformed JSON remains the explicit R5.1 gap.
- Hosted quality and contribution-evidence runs `29291764748` / `29291764902` passed. PR #385 squash-merged at `03af09aba62d3bb16625abf34203c05f012f613e`; Issue #354 closed after telemetry and Milestone #45 advanced to 4/10 completed with cumulative drift score 1.

**R3.5 Evidence (closed)**:

- Added one narrow raw storage-slot/versioned repository authority consumed by Project, Saved Items, and Scenario. Missing keys produce domain defaults without eager writes; present null, corrupt, duplicate, broken-reference, and explicit future values reject before clocks, UUIDs, or storage mutation. Sync replacement first decodes current raw state, preventing a valid remote snapshot from overwriting unsupported local data.
- Added sole domain codecs for lossless Project v1→v2 projection, exact-preserving Saved Items legacy/versionless/v1 input, and the released bare Scenario array. Local stores, remote sync parsing, and Side Panel responses reuse these codecs; obsolete normalizers, duplicate sync validators, and unused direct replacement/delete exports were removed.
- Project v1 sources/files/active IDs and additive fields survive until intentional deletion cleans legacy file references. Scenario keeps built-in order/Chinese labels and saved template/enabled semantics while preserving additive fields. Same-realm read-modify-writes share the local-state lock; cross-realm Scenario centralization remains R4.4, and Project/Memory cross-store cascade atomicity remains an explicit R3.6 boundary.
- Project, Saved Items, and Scenario pages now report repository failures rather than rendering fake empty/default success; Background scenario/context-menu failures are logged. Targeted validation passes 11 files / 113 tests, and TypeScript plus the 60-second full suite pass at 106 files / 817 tests with no orphan Vitest/Vite process. Full `ci:quality` also passes seven prompt goldens, workflow/i18n/automation checks, zero production vulnerabilities, MCP/live-mock/Shell/PoW smoke, Chrome/Edge/Firefox builds and packages, UTF-8/manifest policy, release-asset verification, and `git diff --check`; builds emit only the existing Pyodide `node:*` externalization warnings. Three independent final contract reviews report no remaining P0-P2 finding after the additive-field, Project v1 optional-source, invalid-broadcast, context-menu ordering, and post-commit notification fixes.
- Hosted quality and contribution-evidence runs `29295019441` / `29295019497` passed. PR #386 squash-merged at `3a30229aca99a7d47a5cfc3824e052abdb1e2fc6`; Issue #355 closed after telemetry and Milestone #45 advanced to 5/10 completed with cumulative drift score 1.

**R3.6 Evidence (closed)**:

- Added one exact-preserving Memory codec consumed by IndexedDB, sync, Settings import, Content, and Side Panel. Every ordinary read/mutation validates the complete table and current native DB version; a complete import batch validates before one shared lock and Dexie transaction, so Nth-row failure rolls back every new row and concurrent batches cannot interleave.
- Made Artifact IndexedDB the sole runtime truth. The released Chrome-storage array is strict migration input only: complete legal arrays merge without retention pruning, conflicts/corruption/future DB versions preserve both raw stores, failed cleanup retries, and a lost remove response is verified before convergence succeeds.
- Reused the existing schema-v1 full-preimage recovery journal for Project/Memory cascade deletion. Validated staging happens before journal preparation; every pre-commit failure restores both stores, an unresolved journal remains behind the Background recovery barrier, and no second journal kind or logical Memory ID allocator was introduced.
- Memory and Project UIs decode complete snapshots before committing, retain last-known valid data, end failed initial loading explicitly, and expose repository failures instead of projecting empty success. Missing Memory IDs now fail rather than returning a no-op success. Artifact retention always keeps the just-committed row, and released dual writes treat only Chrome-omitted versus IndexedDB-preserved `undefined` object properties as canonical equivalents while real nested/additive differences remain conflicts.
- Three independent contract reviews reproduced one P1 and five P2 findings across released Artifact dual writes, repository self-poisoning, clock-rollback retention, Project/Memory mixed UI snapshots, stale compatibility targets, and missing-ID updates. All six were fixed with regression coverage; post-fix reviews report no remaining P0-P2 finding.
- Targeted validation passes 15 files / 139 tests. TypeScript and the 60-second full suite pass at 108 files / 846 tests with no orphan Vitest/Vite/WXT process. Full `ci:quality` passes seven prompt goldens, workflow/i18n/automation checks, zero production vulnerabilities, MCP/live-mock/Shell/PoW smoke, Chrome/Edge/Firefox builds and packages, UTF-8/manifest policy, release-asset verification, and `git diff --check`; builds emit only the existing Pyodide `node:*` externalization warnings.
- Hosted quality and contribution-evidence runs `29298217865` / `29298386118` passed. PR #387 squash-merged at `304120fcfbd512a4f46f471dfd58327d05515028`; Issue #356 closed after telemetry and Milestone #45 advanced to 6/10 completed with cumulative drift score 1.

**R3.7 Evidence (closed)**:

- Replaced raw sync-config casts and whole-key writes with one exact-preserving schema-v1 codec/store on the released `deepseek_pp_sync_config` key. Provider-less and unversioned records project read-only to revision 0; explicit writes preserve additive fields and use one in-key monotonic revision/CAS. Future/corrupt values and unverifiable lost-write outcomes fail without overwrite.
- Added one Background FIFO for GET/save/test/auth/upload/download. Every action payload now contains the validated deep-frozen target plus expected revision; upload/download no longer re-read mutable global config or use payload-less commands, and OAuth authorization conditionally publishes its token only to the same revision. Post-effect token/timestamp persistence conflicts or indeterminate commits are classified without claiming a stale baseline and force an authoritative FIFO reread.
- Side Panel captures upload/download targets before confirmation, detects intervening form changes, keeps an operation-active state independent of status text, disables provider/credential fields while pending, and reconciles explicit cross-window conflicts. OAuth access-token caching now requires the refresh-token fingerprint, preventing same-client cross-account reuse without storing or logging the raw credential.
- Existing generation pointer, legacy pointer-absence fallback, local journal/raw rollback, and recovery barrier remain the only remote/local commit protocols. Upload snapshot reads now share the existing local-state lock. Config/coordinator/UI/OAuth tests cover migrations, stale writers, lost responses, FIFO ordering, form changes, provider/apply faults, queue recovery, and credential switching.
- Three independent contract reviews reproduced four distinct P2 findings: notification-failure timestamp rollback, silent `undefined` deletion, post-effect timestamp bookkeeping misclassification, and post-OAuth token persistence misclassification. All were fixed with fault/UI regressions; final reviews report no remaining P0-P2 finding.
- Targeted sync/persistence validation passes 20 files / 201 tests. TypeScript, i18n, seven prompt goldens, and the 60-second full suite pass at 111 files / 881 tests with no orphan Vitest/Vite/WXT process. Full `ci:quality` passes workflow checks, zero production vulnerabilities, automation/MCP/live-mock/Shell/PoW smoke, Chrome/Edge/Firefox builds and packages, UTF-8/manifest policy, release-asset verification, and `git diff --check`; builds emit only the existing Pyodide `node:*` externalization warnings.
- Hosted quality and corrected contribution-evidence runs `29301564567` / `29301618575` passed. PR #388 squash-merged at `08546c2ba45f99472d5a7672c5c112c3a66a5d59`; Issue #357 closed after telemetry and Milestone #45 advanced to 7/10 completed with cumulative drift score 1.

**R3.8 Evidence (closed)**:

- Added the sole exact-preserving Automation v1 codec on the released `deepseek_pp_automations` key. Missing DeepSeek session state, decimal-string/empty message IDs, requests without `deadlineAt`, additive fields, and historical orphan runs remain compatible; future/corrupt/duplicate/nested-invalid state rejects before clocks, UUIDs, mutation, or clear. Obsolete free-form run creation/append paths and their unused input type were removed.
- Automation, Usage, and Tool History now each own one independent non-reentrant whole-key FIFO shared by reads, mutations, and clear. Mutation rereads inside its authority; rejected work does not poison later work. The same small queue primitive replaces the duplicate FIFO implementations in sync action coordination and local-state recovery without joining these three stores to the sync-global lock.
- Usage keeps its released bare array and projects only historical missing fields. Calendar days, enums, IDs, and metrics validate strictly; quality/timestamp-aware merge prevents stale metadata or estimates from replacing newer server state. Content persistence uses a tested signature coordinator that releases only a failed still-owned write for retry. Side Panel caches last-known data per range and generation-fences range changes, slow responses, clear, and post-clear reload against stale resurrection.
- Tool History keeps its released bare array and authoritative tool-record validator. Unsorted legal input up to the historical 200-row limit is ordered before bounded retention; append/clear reject corrupt or future state without overwrite. A non-quota history failure after a provider returned is surfaced as non-retryable with `externalOutcome:ambiguous`, while quota-only history loss remains the existing explicit best effort.
- Automation, Usage, and MCP receiving surfaces decode complete responses before commit, retain the last confirmed state on failure, and treat notifications as invalidations rather than unvalidated payloads. Automation reload generations prevent older focus/notification responses from replacing a newer snapshot or writing after unmount.
- Three independent reviews reproduced and closed the historical-orphan compatibility trap, Usage range/clear response races, invalid day acceptance, unsorted Tool-History eviction, post-provider retry ambiguity, duplicate FIFO implementation, and notification data bypass. Final reviews report no remaining P0-P2 finding.
- Raw compatibility fixtures now cover all three released shapes, aliases, additive fields, historical orphan state, and future/corrupt rejection. TypeScript, i18n, prompt freeze, the 60-second full suite at 118 files / 929 tests, and the complete PC-only `ci:quality` matrix pass: workflow/audit, automation/MCP/live-mock/Shell/PoW smoke, Chrome/Edge/Firefox builds and packages, UTF-8/manifest policy, and release-asset verification. Builds emit only the existing Pyodide `node:*` externalization warnings; Android remains absent and unsupported.
- Hosted quality and contribution-evidence runs `29305277568` / `29305277549` passed. PR #389 squash-merged at `e56bb04d9b5c3058cca85104455f63757f3cb864`; Issue #358 closed after telemetry, Milestone #45 advanced to 8/10 with cumulative drift score 2, and the Level 1 adaptive warning was applied to #359.

**R3.9 Evidence (local validation complete)**:

- Deleted `core/platform/browser.ts`, `PlatformServices`, all five unused storage/runtime/download/file-picker service types, their factory, and every barrel/root re-export. Background capability RPC and Browser Control tool exposure now consume the sole general environment detector; no replacement facade or unconsumed port was introduced.
- The released 15-key capability record, Chromium/Firefox API profiles, `GET_PLATFORM_CAPABILITIES` wire name, and loading-time Native Host gating remain unchanged. A missing or known-invalidated runtime produces explicit `unknown` with all capabilities false; unexpected API access failures now propagate instead of being hidden by the former broad catches.
- Reassigned the three stale T3.2 capability gaps to production-consumer tasks #366, #368, and #370, updated the compatibility registry, persistence registry, module inventory, and risk register, and left Android/mobile code, builds, tests, and platform kinds absent.
- Three independent read-only reviews found no remaining P0-P2 issue after correcting the module-inventory measurements. They confirmed the single detector, explicit known-error degradation, released capability profiles, Native loading sentinel, dead-facade absence, and PC-only repository contract.
- Targeted validation passes 5 files / 28 tests. TypeScript, seven prompt goldens, the 60-second full suite at 118 files / 932 tests, Chrome/Edge/Firefox builds, manifest policy, the 84-file UTF-8/ASCII check, and the complete PC-only `ci:quality` matrix pass with no orphan test/build process. One initial WXT Chrome zip omitted runtime entries and was rejected by `verify:release-assets`; an isolated rebuild and a complete rerun passed, and the observation is recorded on #374 without adding a silent retry. Builds otherwise emit only the existing Pyodide `node:*` externalization warnings.

## Governance Status

**Shared instruction surface**: `AGENTS.md` — canonical and directly maintained.

**Claude Code instruction surface**: unavailable / not used; no live `CLAUDE.md` remains and root `CLAUDE.md` must not be restored as a parallel truth source.

**Scoped instruction surfaces**: `videos/deepseek-pp-promo/AGENTS.md` remains the subtree authority; its byte-identical `CLAUDE.md` duplicate was removed. The archival `docs/archives/**/AGENTS.md` is historical material, not live governance. `.claude/settings.local.json` is local permission configuration only.

**Memory surface**: unavailable; no repo fallback approved or created.

**Memory fallback path**: none.

## Adaptive Control

- Strategy: `PC-browser-only compatibility firewall + telemetry-corrected vertical slices + strangler cutover`.
- Milestone descriptions contain `drift_score`, thresholds, total/completed tasks, and last update time.
- Each completed Issue receives execution telemetry before the PR closes it.
- Threshold actions follow the spec-driven adaptive-control protocol: annotate, halt and replan, or halt and return for scope confirmation.
- Phase 2 reached the replan threshold at `drift_score=3`. Completed work and telemetry remain unchanged; unstarted #322–#336 are closed as `superseded-by-replan`, and replacement #351–#380 reset each remaining milestone segment to drift 0 with recalculated thresholds.

## Next Steps

1. Close any remaining independent-review finding, then complete the final diff/secret/orphan-process scan.
2. Commit and push R3.9, open its PR for #359, and require hosted quality plus contribution-evidence checks.
3. Record execution telemetry, update Milestone #45 adaptive state, and squash-merge only after all hosted checks pass.

## Session Log

| Date | Session | Summary |
|:--|:--|:--|
| 2026-07-13 | Analysis and planning | Completed repository analysis and baseline validation; confirmed scope and governance; generated 6 phases / 26 tasks; created Milestones #43-#48 and Issues #311-#336; converted `AGENTS.md` to the canonical Codex-first instruction surface. |
| 2026-07-13 | Phase 1 execution start | Verified local/remote main at `165ec46`, opened isolated branch `codex/311-compatibility-registry`, and started T1.1 / Issue #311. |
| 2026-07-13 | T1.1 implementation | Built the compatibility registry and runtime-command annex, completed three independent source reviews, corrected mixed Preserve/Gap semantics, and passed the documentation/static/build acceptance checks. |
| 2026-07-13 | T1.1 closure | Merged PR #337 at `48c6a00`, closed Issue #311, recorded task telemetry, and advanced Milestone #43 to 1/5 completed with zero cumulative drift. |
| 2026-07-13 | T1.2 execution start | Opened isolated branch `codex/312-prompt-output-freeze` from `48c6a00` and started byte-level output characterization for Issue #312. |
| 2026-07-13 | T1.2 implementation | Replaced source hashes with explicit raw UTF-8 goldens, froze XML/inline gaps without changing production output, and passed targeted, full-suite, compile, drift-diff, and orphan-process checks. |
| 2026-07-13 | T1.2 closure | Merged PR #338 at `0551eef`, closed Issue #312, recorded task telemetry, and advanced Milestone #43 to 2/5 completed with zero cumulative drift. |
| 2026-07-13 | T1.3 execution start | Opened isolated branch `codex/313-runtime-contract-freeze` from `0551eef` and started cross-runtime contract characterization for Issue #313. |
| 2026-07-13 | T1.3 implementation | Added executable runtime, bridge, tool-record, and sandbox fixtures; centralized real bridge/sandbox boundary authorities without hardening current gaps; passed targeted, full-suite, compile, prompt-freeze, cross-browser build, diff, and orphan-process checks. |
| 2026-07-13 | T1.3 closure | Merged PR #339 at `59e431c`, closed Issue #313, recorded task telemetry, and advanced Milestone #43 to 3/5 completed with zero cumulative drift. |
| 2026-07-13 | T1.4 execution start | Opened isolated branch `codex/314-persistence-sync-freeze` from `59e431c` and started historical persistence and sync compatibility characterization for Issue #314. |
| 2026-07-13 | T1.4 implementation | Centralized persistence identities used by production stores, added raw Memory/Artifact/Project/Saved Items/Scenario/sync fixtures, executed historical IndexedDB upgrades through production code, and kept known loss and partial-commit behavior classified as owned migration gaps. |
| 2026-07-13 | T1.4 closure | Merged PR #340 at `d461c6a`, closed Issue #314, recorded task telemetry, and advanced Milestone #43 to 4/5 completed with zero cumulative drift. |
| 2026-07-13 | T1.5 execution start | Opened isolated branch `codex/315-external-runtime-freeze` from `d461c6a` and started browser, DeepSeek, MCP/Native, Shell, installer, and Android-minimum contract characterization. |
| 2026-07-13 | T1.5 implementation | Centralized route and Native envelope identities, added executable external-runtime fixtures, strengthened manifest and Android staging checks, and passed targeted/full test, compile, prompt, browser build, manifest, audit, protocol, Native Host, and asset-staging validation. |
| 2026-07-13 | T1.5 closure | Merged PR #341 at `91dbe45`, closed Issue #315, completed Milestone #43 at 5/5 tasks with zero cumulative drift, and advanced to Phase 2. |
| 2026-07-13 | T2.1 execution start | Opened isolated branch `codex/316-runtime-message-boundary` from `91dbe45` and audited runtime sender, MAIN/content, tool-record, sandbox Port, and opaque frame trust boundaries. |
| 2026-07-13 | T2.1 implementation | Added browser-owned runtime context and content allowlisting, direction-specific bridge/tool codecs, background-only tab RPC/Port gates, shared sandbox normalization, strict frame/result decoding, and negative sender/source/payload tests without changing released legal wire records. |
| 2026-07-13 | T2.1 closure | Merged PR #342 at `85f5991`, closed Issue #316, recorded task telemetry, and advanced Milestone #44 to 1/6 completed with zero cumulative drift. |
| 2026-07-13 | T2.2 execution start | Opened isolated branch `codex/317-tool-authorization-context` from `85f5991` and audited tool descriptors, runtime dispatch, MCP, externalized payloads, content request lifecycle, local-Skill import, session persistence, and replay boundaries. |
| 2026-07-13 | T2.2 implementation | Added background-owned request grants, content-owned request IDs, per-request descriptor snapshots, one-way chat binding, payload-bound replay protection, provider-first routing, terminal cleanup, compact strict session state, and regression tests; three independent reviews drove structural fixes before closure. |
| 2026-07-13 | T2.2 closure | Merged PR #343 at `279cb3e`, closed Issue #317, recorded telemetry, and advanced Milestone #44 to 2/6 completed with zero cumulative drift. |
| 2026-07-13 | T2.3 execution start | Opened isolated branch `codex/318-android-native-bridge` from `279cb3e`; audited navigation, native bridge, shim, content runtime dependencies, persistence keys, capabilities, Android tooling, and official WebView security contracts. |
| 2026-07-13 | T2.3 implementation | Replaced prefix checks and global JavascriptInterface with parsed navigation plus exact-origin/main-frame WebMessage, introduced a bounded versioned allowlist dispatcher, preserved the Android chat bootstrap after T2.2, removed arbitrary storage and fake downloads, and added JVM/JS/static negative coverage. |
| 2026-07-13 | T2.3 closure | Merged PR #344 at `6daa2a2`, closed Issue #318 after telemetry, and advanced Milestone #44 to 3/6 completed with zero cumulative drift. |
| 2026-07-13 | Platform scope change | User ended Android support and limited the product to PC Chrome/Edge/Firefox; opened T2.3A / Issue #345 and rescaled Milestone #44 to 7 tasks with drift score 1. |
| 2026-07-13 | T2.3A execution start | Paused T2.4 in a clean worktree, opened `codex/345-remove-android-template` from `6daa2a2`, and removed the Android product/build/runtime/test surface while preserving explicit unknown-environment degradation. |
| 2026-07-13 | T2.3A closure | Merged PR #346 at `c3e68bd`, closed Issue #345 after telemetry, passed local/hosted PC-browser-only quality gates, and advanced Milestone #44 to 4/7 with cumulative drift score 1. |
| 2026-07-13 | T2.4 execution start | Rebased `codex/319-sync-generation-atomic` onto PC-only main `c3e68bd`; audited remote persistence, provider, prompt/runtime, and compatibility boundaries before implementing the generation contract. |
| 2026-07-13 | T2.4 implementation | Added generation-scoped payloads, schema-v1 manifest/checksums, last-write current pointer, strict generation reads, legacy pointer-absence fallback, provider port/factory separation, and exhaustive remote-write fault injection. |
| 2026-07-13 | T2.4 closure | Merged PR #347 at `2928d85`, closed Issue #319 after telemetry, passed local/hosted quality and contribution-evidence gates, and advanced Milestone #44 to 5/7 with cumulative drift score 1. |
| 2026-07-13 | T2.5 execution start | Opened `codex/320-sync-download-rollback` from `2928d85`; audited raw persistence, restart, background lifecycle, optional legacy-file, and commit-point boundaries before implementation. |
| 2026-07-13 | T2.5 implementation | Added the versioned recovery DB, pure local apply coordinator, raw browser preimage adapter, deterministic Memory IDs, reverse rollback, startup recovery barrier, and exhaustive local fault/restart/idempotency tests. |
| 2026-07-13 | T2.5 closure | Merged PR #348 at `737c91f`, closed Issue #320 after telemetry, passed local/hosted quality and contribution-evidence gates, advanced Milestone #44 to 6/7 with cumulative drift score 2, and annotated Issue #321 with the adaptive drift warning. |
| 2026-07-13 | T2.6 execution start | Opened `codex/321-automation-cancellation` from `26ef8dc`; audited scheduler/store, active DeepSeek/MCP/tool execution, restart recovery, retry safety, runtime deletion, and frozen UI/command boundaries. |
| 2026-07-13 | T2.6 implementation | Added atomic durable claims, deadline/AbortSignal execution context, settlement-held leases, occurrence dedupe, conservative retry, stale-run recovery, terminal fencing, historical deadline normalization, and targeted cancellation/restart/MCP contract coverage without adding a user-facing command or protocol field. |
| 2026-07-13 | T2.6 closure | PR #350 passed local/hosted gates and merged at `1b933d1`; Issue #321 and Milestone #44 closed after telemetry, completing Phase 2 at 7/7 with cumulative drift score 3. |
| 2026-07-13 | Adaptive replan | Halted before Phase 3, replaced unstarted #322–#336 with bounded #351–#380 vertical slices, reset Milestone #45–#48 adaptive state, removed redundant Pyodide-first-use work, assigned every frozen background command and persistence gap exactly once, and preserved PC Chrome/Edge/Firefox-only scope. |
| 2026-07-13 | R3.1 execution start | Opened isolated branch `codex/351-typed-handler-seam` from `2bbc105` and started the two-command typed registry seam for Issue #351. |
| 2026-07-13 | R3.1 implementation | Established exclusive `2 typed / 119 legacy / 2 client-only` ownership, migrated the two bootstrap handlers and callers, made unknown dispatch explicit, and passed targeted/full tests plus the PC Chrome/Edge/Firefox quality matrix. |
| 2026-07-13 | R3.1 closure | PR #382 merged at `16eec9a`, Issue #351 closed after telemetry, and Milestone #45 advanced to 1/10 completed with zero cumulative drift. |
| 2026-07-13 | R3.2 execution start | Opened isolated branch `codex/352-tool-provider-registry` from `16eec9a`; audited tool runtime/provider composition, authorization, externalized payload, MCP persistence/protocol/transport, Content sync, and import-cycle boundaries. |
| 2026-07-13 | R3.2 implementation | Added the sole ordered provider registry and strict MCP v1 codec, removed name-based and permissive fallback paths, closed unsupported transport/protocol behavior, preserved legal v1/cache/additive data, and passed targeted/full tests plus the PC Chrome/Edge/Firefox quality matrix. |
| 2026-07-13 | R3.2 closure | PR #383 passed hosted quality/contribution gates and squash-merged at `e8c83a8`; Issue #352 closed after telemetry and Milestone #45 advanced to 2/10 with cumulative drift score 1. |
| 2026-07-13 | R3.3 execution start | Opened isolated branch `codex/353-deepseek-protocol-core` from `e8c83a8`; audited active automation, Web/Official/export requests, route/body/SSE ownership, deadlines, byte budgets, late effects, and R3.4 passive boundaries. |
| 2026-07-13 | R3.3 implementation | Added pure request/SSE codecs, an injected Active Client port and one deadline/body policy; removed duplicate completion readers/requests and retired automation bridge code; passed targeted/full cancellation, late-response, compatibility, and import-boundary tests. |
| 2026-07-13 | R3.3 closure | PR #384 passed hosted quality/contribution gates and squash-merged at `58cd05d`; Issue #353 closed after telemetry and Milestone #45 advanced to 3/10 with cumulative drift score 1. |
| 2026-07-13 | R3.4 execution start | Opened `codex/354-passive-deepseek-protocol` from `58cd05d`; audited passive Fetch/XHR route, request augmentation, SSE framing/reduction, visible stream filtering, cancellation, backpressure, and bridge boundaries. |
| 2026-07-13 | R3.4 implementation | Reused the exact route and raw SSE authorities from passive Fetch/XHR, removed substring/facade/local framing paths, unified passive response state, and added CRLF/UTF-8/raw-frame/cancellation/backpressure regression coverage without changing prompt or bridge bytes. |
| 2026-07-13 | R3.4 closure | PR #385 passed hosted quality/contribution gates and squash-merged at `03af09a`; Issue #354 closed after telemetry and Milestone #45 advanced to 4/10 with cumulative drift score 1. |
| 2026-07-13 | R3.5 execution start | Opened `codex/355-versioned-browser-repositories` from `03af09a`; audited Project v1/v2, Saved Items legacy/v1/future, released Scenario arrays, sync replacement, UI error projection, and same-realm concurrency boundaries. |
| 2026-07-13 | R3.5 implementation | Added one raw-slot/versioned repository contract and three sole domain codecs, removed duplicate normalizers/validators and silent fallbacks, preserved legal legacy/additive data, guarded future/corrupt state from local/sync overwrite, and added concurrency/UI regression coverage. |
| 2026-07-13 | R3.5 closure | PR #386 passed hosted quality/contribution gates and squash-merged at `3a30229`; Issue #355 closed after telemetry and Milestone #45 advanced to 5/10 with cumulative drift score 1. |
| 2026-07-13 | R3.6 execution start | Opened `codex/356-memory-artifact-indexeddb` from `3a30229`; audited Memory v1-v3/import/sync/UI, Artifact legacy/IndexedDB convergence, Project cascade, recovery journal, and future/corrupt preservation boundaries. |
| 2026-07-13 | R3.6 implementation | Added sole Memory/Artifact codecs and explicit DB-version guards, transactional Memory batches, one-way Artifact migration, journaled Project/Memory cascade, and visible last-known-state UI errors without restoring Android or adding a second persistence truth. |
| 2026-07-13 | R3.6 local validation | Closed all six independent-review findings; passed 15 files / 139 targeted tests, 108 files / 846 full tests, TypeScript, the complete PC Chrome/Edge/Firefox quality/package matrix, diff checks, and orphan-process checks. |
| 2026-07-14 | R3.6 closure | Hosted quality/contribution runs passed; PR #387 squash-merged at `304120f`, Issue #356 closed after telemetry, and Milestone #45 advanced to 6/10 with cumulative drift score 1. |
| 2026-07-14 | R3.7 execution start | Opened `codex/357-sync-confirmed-target-fencing` from `304120f`; audited UI confirmation, runtime payloads, config writes, remote/local ordering, OAuth credential identity, and existing generation/journal contracts before implementing the single sync authority. |
| 2026-07-14 | R3.7 implementation | Added the exact-preserving config codec/CAS, complete-action FIFO, immutable confirmed targets, locked upload snapshots, credential-bound OAuth cache, explicit post-effect persistence classification, and Side Panel reconciliation without changing the generation or local-journal protocols. |
| 2026-07-14 | R3.7 local validation | Closed four independent-review P2 findings; passed 20 files / 201 targeted tests, 111 files / 881 full tests, TypeScript, the complete PC Chrome/Edge/Firefox quality/package matrix, diff checks, and orphan-process checks. |
| 2026-07-14 | R3.7 closure | Hosted quality/contribution runs passed; PR #388 squash-merged at `08546c2`, Issue #357 closed after telemetry, and Milestone #45 advanced to 7/10 with cumulative drift score 1. |
| 2026-07-14 | R3.8 execution start | Opened `codex/358-automation-usage-history` from `08546c2`; began the version, mutation-authority, concurrency, restart, and sync-lock audit for Automation, Usage, and Tool History. |
| 2026-07-14 | R3.8 implementation | Added strict released-shape codecs, independent whole-key authorities, the shared FIFO primitive, stale-writer and UI generation fencing, explicit post-provider history failure semantics, and raw compatibility fixtures without restoring Android or changing released keys. |
| 2026-07-14 | R3.8 local validation | Closed all independent-review P0-P2 findings; passed 118 files / 929 full tests, TypeScript, prompt/i18n checks, the complete PC Chrome/Edge/Firefox quality/package matrix, smoke tests, diff checks, and orphan-process checks. |
| 2026-07-14 | R3.8 closure | Hosted quality/contribution runs passed; PR #389 squash-merged at `e56bb04`, Issue #358 closed after telemetry, and Milestone #45 advanced to 8/10 with cumulative drift score 2. |
| 2026-07-14 | R3.9 execution start | Applied the Level 1 adaptive warning, opened `codex/359-platform-capability-truth` from `e56bb04`, and audited the dead facade, capability consumers, unknown degradation, generated manifests, and current gap ownership before deletion. |
| 2026-07-14 | R3.9 implementation | Removed the zero-consumer broad platform facade and catches, retained one consumed capability detector plus explicit known-error degradation, reassigned stale gap owners, and preserved the released 15-key PC-browser contract without restoring Android. |
| 2026-07-14 | R3.9 local validation | Passed 5 files / 28 targeted tests, 118 files / 932 full tests, TypeScript, prompt freeze, the complete PC Chrome/Edge/Firefox quality/package matrix, manifest/UTF-8/release checks, diff checks, and orphan-process checks; one rejected incomplete Chrome zip was recorded for R5.2 stress coverage. |
