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
- **Issue range**: [#311](https://github.com/zhu1090093659/deepseek-pp/issues/311) through [#345](https://github.com/zhu1090093659/deepseek-pp/issues/345)
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
| 1 | Compatibility Firewall | [#43](https://github.com/zhu1090093659/deepseek-pp/milestone/43) | 0 | 5 | 5 |
| 2 | Critical Boundaries and Failure Safety | [#44](https://github.com/zhu1090093659/deepseek-pp/milestone/44) | 1 | 6 | 7 |
| 3 | Authoritative Contracts and Real Ports | [#45](https://github.com/zhu1090093659/deepseek-pp/milestone/45) | 5 | 0 | 5 |
| 4 | Strangler Cutover of Runtime Hotspots | [#46](https://github.com/zhu1090093659/deepseek-pp/milestone/46) | 5 | 0 | 5 |
| 5 | Stability and Compatibility Closure | [#47](https://github.com/zhu1090093659/deepseek-pp/milestone/47) | 2 | 0 | 2 |
| 6 | Measured Performance Optimization | [#48](https://github.com/zhu1090093659/deepseek-pp/milestone/48) | 3 | 0 | 3 |

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

# Open Phase 2 tasks
gh issue list -R zhu1090093659/deepseek-pp \
  --milestone '[core-refactor-2026-07] Phase 2: Critical Boundaries and Failure Safety' \
  --state open \
  --json number,title
```

## Phase Checklist

- [x] Phase 1: Compatibility Firewall (5/5 tasks) — [milestone](https://github.com/zhu1090093659/deepseek-pp/milestone/43)
- [ ] Phase 2: Critical Boundaries and Failure Safety (6/7 tasks) — [milestone](https://github.com/zhu1090093659/deepseek-pp/milestone/44)
- [ ] Phase 3: Authoritative Contracts and Real Ports (0/5 tasks) — [milestone](https://github.com/zhu1090093659/deepseek-pp/milestone/45)
- [ ] Phase 4: Strangler Cutover of Runtime Hotspots (0/5 tasks) — [milestone](https://github.com/zhu1090093659/deepseek-pp/milestone/46)
- [ ] Phase 5: Stability and Compatibility Closure (0/2 tasks) — [milestone](https://github.com/zhu1090093659/deepseek-pp/milestone/47)
- [ ] Phase 6: Measured Performance Optimization (0/3 tasks) — [milestone](https://github.com/zhu1090093659/deepseek-pp/milestone/48)

## Current Status

**Active Phase**: Phase 2 — Critical Boundaries and Failure Safety (in progress)

**Active Task**: T2.6 / [Issue #321](https://github.com/zhu1090093659/deepseek-pp/issues/321) — Propagate automation cancellation, lease, and idempotency.

**Execution Branch**: `codex/321-automation-cancellation` in isolated worktree `/Users/zcl/code/deepseek-pp-worktrees/321-automation-cancellation`, based on `origin/main@26ef8dc`.

**Blockers**: None. Work is isolated from the original repository's user-owned changes.

**Baseline Evidence**: PC-only main is `26ef8dc` after T2.5 closed at `737c91f` and its progress closeout merged. T2.5 passed 92 test files / 671 tests, full `ci:quality`, Chrome/Edge/Firefox builds/packages, source archive inspection, hosted quality run `29267498354`, and contribution-evidence run `29267706250`. Android project/build/runtime/test support is retired.

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
- Added legal and malformed fixtures for runtime requests/responses/errors, bridge traffic, tool wire records, and sandbox multi-hop traffic; permissive shallow envelopes and other unsafe accepted behavior remain labeled `current-gap` with T2.1, T2.2, or T3.1 owners.
- Preserved current legal behavior and error text while removing duplicated boundary normalization. Targeted validation passed 4 files / 71 tests; the full suite passed 66 files / 433 tests, compile, prompt freeze, and Chrome/Edge/Firefox builds passed, and no test child process remained.

**T1.4 Evidence**:

- Centralized the released Memory and Artifact database identities, schemas, retention limit, and legacy key in contract modules consumed by the production stores; centralized Project, Saved Items, Scenario, sync-config, and six remote sync keys without changing their values.
- Added raw fixtures for Memory v1-v3, Artifact legacy storage, released Project v1/v2, Saved Items legacy/v1/future, Scenario storage, and every required/optional sync JSON file.
- Executed Memory v1→v3 and v2→v3 upgrades, v3 project-scope reopen, and Artifact legacy migration through the production Dexie stores with fake IndexedDB. At the T1.4 freeze point, Project v1 reset, malformed Artifact filtering, Saved Items future-version downgrade, Scenario read fallback, and sync partial commits were labeled gaps owned by T2.4, T2.5, or T3.3; T2.4 and T2.5 are now closed.
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
- Fault injection covers every payload/manifest/pointer write boundary, all-settled staging with provider error detail, lost pointer responses, commit-indeterminate verification, concurrent publishers, strict read failures, and newest-live Google Drive canonical-object selection that excludes trashed duplicates. T2.5 has since closed staged local apply and rollback; config-operation serialization/concurrent overwrite remains assigned to T6.3, and committed-with-local-bookkeeping warning UX remains assigned to T5.1.
- Current validation passes 6 targeted files / 73 tests and the 60-second full suite at 84 files / 613 tests, plus TypeScript compile, prompt freeze, i18n, manifest/UTF-8 policy, Chrome/Edge/Firefox builds, `git diff --check`, and orphan-process checks. Three independent final reviews report no remaining merge blocker after provider error-detail, raw-fixture, lost-response, manifest-integrity, and GDrive duplicate-object corrections.
- PR #347 merged at `2928d85f5d0de361a98af461d5e54a566709d36f`; Issue #319 closed after telemetry, hosted quality and contribution-evidence runs passed, and Milestone #44 advanced to 5/7 with cumulative drift score 1.

**T2.5 Evidence (closed)**:

- Replaced parallel multi-store download mutation with a pure local-apply coordinator and production browser/IndexedDB ports. Remote generation/legacy reads, schema validation, local-import merge, occurrence-stable duplicate-`syncId` Memory-ID planning, and active-preset decisions finish before journal preparation.
- Added `DeepSeekPPSyncRecovery` v1 with singleton `journal/current`. The SHA-256-protected record stores raw Memory rows and opaque present/value preimages for Skills, Skill Sources, Presets, active preset, Project Context, and Saved Items; unknown/corrupt/future journals fail closed without deletion.
- Fixed-order target writes are committed only by deleting the journal. Every apply failure restores all stores in reverse order; incomplete rollback keeps the record for restart recovery. Lost prepare/clear responses are read back, and an unverifiable clear is reported as commit-indeterminate rather than guessed.
- Local Skill-import merge, sync apply/recovery, ordinary Memory/Skill/Preset/Project/Saved Items mutations, and project/Memory cascade deletion now share one non-reentrant local-state lock, while the coordinator calls explicit already-locked store primitives. Failed-apply recovery runs before lock release; if it remains incomplete, the lock is fail-closed and retries recovery before any queued write or second download can stage. Background recovery gates runtime dispatch, stale-Memory archival, and startup/alarm automation scans; transient durable-recovery failures are retried by the next dispatch, and post-recovery broadcast failure is reported without poisoning readiness.
- Exact rollback covers released raw Memory rows/IDs/unknown fields plus all affected raw key values/absence. IndexedDB cannot rewind its hidden `++id` generator, so a failed high-ID target can only make a future new ID skip forward; this has executable fake-IndexedDB evidence, loses no row/reference/retry identity, and remains an explicit `DB-001`/T3.3 schema-design gap rather than a silent compatibility claim.
- Targeted validation passes 14 files / 117 tests, including every target write's fail-before/commit-then-throw boundary, every recovery-write failure, queued mutation/download recovery ordering, all interrupted prefixes, corrupt/future/checksum journals, idempotent retry, executable raw journal fixture, raw missing-key restoration, occurrence-stable duplicate Memory IDs, and fake-IndexedDB reopen/generator evidence. The 60-second full suite passes 92 files / 671 tests; full `ci:quality` also passes prompt freeze, TypeScript, workflow/i18n/automation checks, zero high production vulnerabilities, MCP/live-mock/Shell/PoW smoke, Chrome/Edge/Firefox builds and packages, UTF-8/manifest policy, release assets, and `git diff --check`.
- PR #348 merged at `737c91f65d4a8f04c11cc55451748379ef903437`; Issue #320 closed after telemetry, hosted quality and contribution-evidence runs passed, and Milestone #44 advanced to 6/7 with cumulative drift score 2. The annotate threshold was reached, so Issue #321 carries the adaptive drift warning before T2.6 starts.

**T2.6 Evidence (in progress)**:

- Replaced the timeout `Promise.race`/in-memory-only lock with one atomic persisted `running` claim plus an in-process execution lease. The scheduler aborts at the deadline but awaits the real executor settlement before releasing authority; terminal writes are fenced to the same still-running row.
- Added an execution context carrying run/automation IDs, persisted deadline, attempt, `AbortSignal`, current-lease assertion, and stable scoped idempotency keys. DeepSeek session/PoW/completion/history, automation continuation, runtime tools, web providers, MCP initialization/call, and cancellable transports receive the signal without changing released request bodies, headers, JSON-RPC IDs, commands, or UI. Concurrent PoW cold starts share one cancellable WASM load, while unconsumed web responses explicitly release their bodies.
- Scheduled runs use stable occurrence identity and also deduplicate historical random run IDs by `(automationId,scheduledFor)`. Fresh persisted rows block restart execution; expired rows close as non-retryable ambiguous failures and advance without replay. Only explicit `retrySafe:true` plus `externalOutcome:not_started` results may retry; post-dispatch and thrown failures are terminal.
- Store mutations are serialized in one authority; claim and finalization are atomic within the service worker. Historical runner requests without `deadlineAt` derive the released 180-second window from `requestedAt`. Deleting an automation first aborts the active context, while late executor output cannot recreate or overwrite deleted/terminal state.
- Final local validation passes targeted cancellation/MCP slices, TypeScript compile, and the 60-second full suite at 97 files / 710 tests. Full `ci:quality` also passes seven prompt goldens, workflow/i18n/automation checks, zero high production vulnerabilities, MCP/live-mock/Shell/PoW smoke, Chrome/Edge/Firefox builds and packages, UTF-8/manifest policy, and release-asset verification. Coverage includes timeout settlement, internal cancellation, stable retry keys, no ambiguous retry, scheduled occurrence dedupe, restart lease recovery, legacy deadline normalization, finalization fencing, shared cancellable PoW loading, web-response release, DeepSeek signal propagation, continuation cancellation, and MCP/Native cancellation. Independent final reviews report no P0/P1/P2 blocker.

## Governance Status

**Shared instruction surface**: `AGENTS.md` — canonical and directly maintained.

**Claude Code instruction surface**: unavailable / not used; no live `CLAUDE.md` remains and root `CLAUDE.md` must not be restored as a parallel truth source.

**Scoped instruction surfaces**: `videos/deepseek-pp-promo/AGENTS.md` remains the subtree authority; its byte-identical `CLAUDE.md` duplicate was removed. The archival `docs/archives/**/AGENTS.md` is historical material, not live governance. `.claude/settings.local.json` is local permission configuration only.

**Memory surface**: unavailable; no repo fallback approved or created.

**Memory fallback path**: none.

## Adaptive Control

- Strategy: `PC-browser-only compatibility firewall + risk-first vertical slices + strangler cutover`.
- Milestone descriptions contain `drift_score`, thresholds, total/completed tasks, and last update time.
- Each completed Issue receives execution telemetry before the PR closes it.
- Threshold actions follow the spec-driven adaptive-control protocol: annotate, halt and replan, or halt and return for scope confirmation.

## Next Steps

1. Run the full 60-second suite and `ci:quality`, including prompt/contract checks, Chrome/Edge/Firefox builds/packages, protocol smokes, release assets, diff, and orphan-process checks.
2. Complete independent final contract/diff reviews and correct any blocker without widening released automation commands or UI.
3. Open and merge the T2.6 PR after hosted checks, record Issue telemetry, then close Phase 2 through the adaptive-control protocol before starting Phase 3.

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
