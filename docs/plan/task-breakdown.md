# DeepSeek++ Reliability and Compatibility Refactor — Task Breakdown

## Overview

- **Run ID**: `core-refactor-2026-07`
- **Strategy**: Compatibility firewall first, then risk-first vertical slices and strangler cutover
- **Total Phases**: 6
- **Total Tasks**: 27
- **Estimated Total Effort**: XL
- **Tracking Mode**: `GITHUB_STANDARD` (Issues + Milestones + PR, no Project board)

The plan intentionally combines two approaches. Phase 1 freezes the externally observable contracts that cannot drift; Phase 2 immediately removes the highest-impact safety, data-integrity, and cancellation risks. Ports are introduced only when the same task connects a real production consumer, and each migrated path deletes the obsolete implementation instead of leaving a parallel router, validator, or storage truth source.

## Non-Negotiable Compatibility Invariants

- Preserve prompt byte output, tool XML tags, inline-agent continuation/finalization semantics, and existing user-facing behavior.
- Preserve all storage keys, IndexedDB names/tables/identity, recognized schema versions, sync/export records, runtime message names, MAIN/content bridge records, MCP contracts, and Native Host contracts.
- Preserve PC Chrome, Edge, and Firefox support and make feature degradation explicit. Android and other mobile targets are unsupported and must not regain a parallel implementation without an explicit scope decision.
- Every schema change requires an explicit, deterministic, idempotent migration. Unknown future versions and corrupt data must fail visibly without overwriting the original state.
- Do not create a standalone E2E, coverage, or performance-infrastructure program. Each behavior, data, security, routing, permission, persistence, caching, or performance task adds the narrow automated evidence needed for its own acceptance criteria.
- `AGENTS.md` is the sole project-level agent instruction truth source. Do not create `CLAUDE.md` or a repo-local memory file. Stable new engineering rules belong in `AGENTS.md`; execution state belongs in GitHub and `docs/progress/MASTER.md`.
- Preserve the user's existing uncommitted work in `core/platform/chrome-api.ts`, `entrypoints/content/adapters/chat-launcher.ts`, and `tests/chat-launcher.test.ts`. Task T4.3 must not overwrite or absorb it without explicit provenance.

## S.U.P.E.R Design Constraints

- **S — Single Purpose**: Every extracted module, handler, controller, or function owns one responsibility and one lifecycle.
- **U — Unidirectional Flow**: Data flows from schema/parser to application handler to domain service to port. Contract modules do not import concrete implementations, and new cycles are forbidden.
- **P — Ports over Implementation**: Cross-runtime and external I/O use serializable contracts and narrow ports. A new port must gain a production consumer in the same task.
- **E — Environment-Agnostic**: Browser, native-host, DOM, and remote-service differences are isolated in adapters and composition roots.
- **R — Replaceable Parts**: Replacing a provider or adapter must not require unrelated domain changes. Broad unused abstractions are removed rather than expanded.

## Scope Amendment

On 2026-07-13, T2.3A / [#345](https://github.com/zhu1090093659/deepseek-pp/issues/345) superseded the Android parts of T1.1, T1.5, and T2.3. Those completed rows remain historical evidence; the current contract removes the mobile template and supports PC Chrome, Edge, and Firefox only.

## Testing and Governance Constraints

- Behavior-changing tasks add or update targeted automated tests and then run the applicable type, prompt-freeze, build, manifest, and smoke checks in the repository's required order.
- Backend/unit test commands use a hard 60-second timeout. After timeout or interruption, verify the process group exited and no orphaned Vitest/test child remains.
- Security-sensitive GitHub Issues describe only the public repair objective and verifiable outcome; detailed trust-boundary evidence remains in `docs/analysis/risk-assessment.md`.
- Before completing a task, scan the diff for duplicate logic, hidden fallbacks, swallowed errors, second truth sources, dead code, contract drift, and unmentioned behavior changes.
- If execution reveals a durable project invariant or recurring workflow rule, update `AGENTS.md`. Do not write task progress or transient findings there.

## Phase 1: Compatibility Firewall

**Goal**: Freeze every externally observable behavior and historical-data contract before structural changes.

**Prerequisite**: Confirmed scope in `docs/analysis/project-overview.md`.

**S.U.P.E.R Focus**: P, R — contracts precede implementations and preserve replaceability.

| ID | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Governance Impact | Primary Surfaces | Acceptance Criteria |
|:--|:--|:--:|:--:|:--|:--:|:--:|:--|:--|:--|:--|
| T1.1 | Establish compatibility contract registry | P0 | M | — | A | P, R | Docs-only; validate links, identifiers, and current commands | Update `AGENTS.md` only if a stable invariant is discovered | `docs/compatibility/*`, analysis docs | Registry enumerates prompt, storage, DB, schema, message, browser, MCP, and Native Host contracts; its former Android-minimum rows are historical and retired by T2.3A. |
| T1.2 | Freeze prompt, tool XML, and inline-agent output | P0 | M | T1.1 | B | P, R | Add byte-level golden cases; run prompt freeze and targeted Vitest | Same default | `core/prompt/*`, `core/tool/xml-tags.ts`, `core/inline-agent/*`, `scripts/prompt-freeze.mjs`, `tests/*` | Representative memory, Skill, preset, project, MCP, Shell, and inline-agent scenarios are byte-stable; any drift produces a readable diff; all pre-existing outputs remain unchanged. |
| T1.3 | Freeze runtime, bridge, tool, and sandbox contracts | P0 | L | T1.1 | C | P, U, R | Add request/response/error/malformed contract fixtures | Same default | `core/types.ts`, `core/messaging/*`, `core/tool/types.ts`, `core/sandbox/*`, runtime entrypoints | `MessageAction`, background cases, bridge envelopes, tool records, and sandbox records are enumerated and testable; malformed fixtures expose current gaps without promoting unsafe acceptance into the target contract. |
| T1.4 | Freeze persistence and sync compatibility fixtures | P0 | L | T1.1 | D | P, R | Add historical IndexedDB/storage/sync fixtures using existing test stack | Same default | `core/memory/*`, `core/artifact/*`, `core/project/*`, `core/saved-items/*`, `core/scenario/*`, `core/sync/*` | Fixtures cover Memory v1-v3, artifact legacy storage, project v1/v2, saved items, scenario, and sync JSON; known data-loss paths are recorded as failing migration requirements rather than frozen as successful behavior. |
| T1.5 | Freeze external runtime capability contracts | P0 | L | T1.1 | E | P, E, R | Extend existing build/manifest/smoke and protocol fixtures | Same default | `core/deepseek/*`, `core/interceptor/*`, `core/platform/*`, `core/mcp/*`, `core/shell/*`, `wxt.config.ts`, `packages/shell-host/*` | DeepSeek route/header/SSE rules, browser capability/permission degradation, and MCP/Native envelope/tool/installer contracts are explicit; its former Android fixture is historical and retired by T2.3A. |

### Parallel Lanes

| Lane | Tasks | Merge Risk | Notes |
|:--|:--|:--|:--|
| A | T1.1 | Low | Complete first; it defines the registry structure consumed by all other lanes. |
| B | T1.2 | Low | Prompt/output fixtures only. |
| C | T1.3 | Medium | Shares fixture helpers and root types with Lane E. |
| D | T1.4 | Low | Persistence fixtures are isolated by store. |
| E | T1.5 | Medium | Cross-runtime contracts and fixture indexes can overlap Lane C. |

## Phase 2: Critical Boundaries and Failure Safety

**Goal**: Remove the P0 trust-boundary, unsupported-platform, sync-integrity, and cancellation hazards without breaking frozen contracts.

**Prerequisite**: Phase 1 complete.

**S.U.P.E.R Focus**: S, U, P, R — one authorization path, one atomic state transition, and end-to-end execution context.

| ID | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Governance Impact | Primary Surfaces | Acceptance Criteria |
|:--|:--|:--:|:--:|:--|:--:|:--:|:--|:--|:--|:--|
| T2.1 | Harden extension runtime message boundary | P0 | L | T1.3, T1.5 | A | U, P, E | Add valid-source and malformed/unauthorized negative tests | Update `AGENTS.md` if a durable trust-boundary rule emerges | `core/messaging/*`, `core/sandbox/contracts.ts`, background/content/MAIN and sandbox runtime entrypoints | Receivers construct trusted sender/tab/frame/session context and validate privileged runtime, port, and frame messages before I/O; legal fixtures preserve results; invalid sources are rejected without a page-readable shared secret. |
| T2.2 | Bind tool execution authorization context | P0 | L | T1.2, T2.1 | A | S, P, R | Add unknown, disabled, stale, replay, and cross-session tests | Same default | `core/tool/types.ts`, `core/tool/runtime.ts`, `core/mcp/*`, background/content tool flow | Extension-owned context binds descriptor, provider, mode, risk, session, and call id; unauthorized calls fail before provider execution; prompt ordering, history, and visible tool results remain compatible. |
| T2.3 | Minimize Android WebView native bridge | P0 | M | T1.5 | B | S, P, E, R | Historical JVM/JS negative coverage | Historical rule was recorded, then retired | Historical Android implementation | Completed by #318, then superseded by T2.3A when the product scope changed to PC browsers only. |
| T2.3A | Remove Android template and support surface | P0 | M | T2.3 | B | S, U, E, R | Add PC-only repository and unknown-environment contracts; run all-browser closure | Record the PC-only invariant in `AGENTS.md` | Android project, platform detection, package scripts, CI, tests, active docs | Android implementation/build/test/release surfaces are absent; Chrome/Edge/Firefox remain supported; non-extension environments are explicit `unknown` with all capabilities false. |
| T2.4 | Make sync uploads generation-atomic | P0 | L | T1.4 | C | S, U, P | Add upload fault injection at every remote write | Update `AGENTS.md` if the generation contract becomes a durable rule | `core/sync/*`, background sync application flow | A generation manifest records schema, file list, and checksums; temporary generation files complete before the current pointer is published; any failure leaves the previous generation authoritative; legacy remote reads remain supported without dual writes. |
| T2.5 | Add staged sync download, journal, and rollback | P0 | L | T2.4 | C | U, P, R | Add per-write fault injection, restart recovery, and idempotent retry tests | Same default | `core/sync/*`, persistence stores/repositories, background sync flow | Download validates fully in staging, records a recovery journal, commits deterministically, and restores the exact pre-download state after any injected failure; restart recovery and retries are idempotent. |
| T2.6 | Propagate automation cancellation, lease, and idempotency | P0 | L | T1.3, T1.5 | D | U, P, R | Add timeout/abort/late-side-effect/retry tests | Record stable cancellation semantics in `AGENTS.md` if needed | `core/automation/*`, `core/deepseek/*`, `core/tool-loop/*`, background/content execution flow | Run id, deadline, `AbortSignal`, lease validation, and supported idempotency keys reach PoW, request/stream, and tool execution; a lease is released only after real termination; ambiguous external outcomes are not silently retried. |

### Parallel Lanes

| Lane | Tasks | Merge Risk | Notes |
|:--|:--|:--|:--|
| A | T2.1 → T2.2 | High | Central tool/runtime path; strictly sequential. |
| B | T2.3 → T2.3A | Low | Historical bridge hardening followed by complete removal of the unsupported platform surface. |
| C | T2.4 → T2.5 | Medium | Sequential generation then rollback contract. |
| D | T2.6 | High | Can implement independently, but rebase after Lane A before central wiring. |

## Phase 3: Authoritative Contracts and Real Ports

**Goal**: Make typed commands, narrow environment ports, persistence codecs, the DeepSeek protocol adapter, and the tool registry authoritative through real consumers.

**Prerequisite**: Phase 2 complete.

**S.U.P.E.R Focus**: U, P, E, R — contracts point inward and environment details stay at the edge.

| ID | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Governance Impact | Primary Surfaces | Acceptance Criteria |
|:--|:--|:--:|:--:|:--|:--:|:--:|:--|:--|:--|:--|
| T3.1 | Establish exhaustive runtime command map and handler port | P0 | XL | T2.1, T2.2 | A | S, U, P | Add exhaustive command/request/response contract tests | Update `AGENTS.md` if the command registration rule is durable | `core/messaging/*`, `core/types.ts`, `entrypoints/background.ts`, Side Panel runtime client | Every existing command maps exactly once; the entrypoint parses once before the existing implementation path; request/response types are serializable; no second router is introduced. |
| T3.2 | Adopt narrow platform ports with real consumers | P1 | L | T1.5, T2.3A | B | U, P, E, R | Add adapter contract tests and all-browser build checks | Record the no-dead-port rule in `AGENTS.md` if newly required | `core/platform/*`, entrypoint composition roots, first production consumers | Storage, runtime, permission, identity, and download boundaries are separate; globals remain in adapters/composition roots; each new port has a real production consumer in this task; broad unused abstractions are removed. |
| T3.3 | Version persistence codecs, repositories, and transaction boundary | P1 | XL | T2.5, T3.2 | B | S, U, P, R | Add real IndexedDB migration, corrupt/future-version, and transaction tests | Record the migration invariant in `AGENTS.md` if durable | Memory/artifact/project/saved-items/scenario/usage/automation persistence modules | DB/key identity remains unchanged; project v1 migrates without loss; artifact legacy input migrates idempotently to one truth source; corrupt/future versions fail visibly without overwrite; transaction behavior is exercised by production consumers. |
| T3.4 | Separate DeepSeek protocol, network policy, and page adapter | P1 | XL | T2.6, T3.2 | C | S, U, P, E, R | Add pure request/stream/route fixtures and abort/timeout tests | Record stable protocol boundaries only if they guide future work | `core/deepseek/*`, `core/interceptor/*`, content adapters | Request/stream parsing is pure; passive page hooks and active clients use shared codecs; selectors/routes have one source; abort, timeout, and body budget are consistent; prompt and stream goldens remain unchanged. |
| T3.5 | Replace hard-coded tool dispatch and split contract cycles | P1 | L | T3.1, T3.2 | A | S, U, P, R | Add registry order, duplicate, unknown-provider, and import-cycle checks | Record provider registration rules in `AGENTS.md` if durable | `core/tool/*`, `core/types.ts`, `core/constants.ts`, tool providers | Providers register only at the composition root; adding a provider does not edit runtime dispatch; descriptor order/serialization/prompt output stay stable; contract modules stop importing implementations and the targeted SCCs disappear. |

### Parallel Lanes

| Lane | Tasks | Merge Risk | Notes |
|:--|:--|:--|:--|
| A | T3.1 → T3.5 | High | Command map precedes registry; central contracts require sequential integration. |
| B | T3.2 → T3.3 | Medium | Platform consumers precede persistence convergence. |
| C | T3.4 | Medium | May touch shared root types; rebase before final phase merge. |

## Phase 4: Strangler Cutover of Runtime Hotspots

**Goal**: Reduce the background, content, Side Panel, floating-chat, and Shell Host monoliths to composition roots while deleting migrated legacy paths.

**Prerequisite**: Phase 3 complete.

**S.U.P.E.R Focus**: S, U, P, R — lifecycle and domain ownership replace monolithic control flow.

| ID | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Governance Impact | Primary Surfaces | Acceptance Criteria |
|:--|:--|:--:|:--:|:--|:--:|:--:|:--|:--|:--|:--|
| T4.1 | Migrate background to domain handlers and a composition root | P1 | XL | T2.5, T2.6, T3.1, T3.3, T3.5 | A | S, U, P, R | Add domain handler and service-worker lifecycle/recovery tests | Record handler ownership rules in `AGENTS.md` if durable | `entrypoints/background.ts`, new background handler modules | Each command has exactly one handler; the root retains only bootstrap, lifecycle, registration, and composition; each migrated case is deleted immediately; MV3 restart/recovery behavior remains compatible. |
| T4.2 | Migrate content to a lifecycle kernel and capability controllers | P1 | XL | T3.1, T3.2, T3.4, T3.5 | B | S, U, P, R | Add idempotent start/stop, reinjection, and navigation tests | Record controller ownership rules in `AGENTS.md` if durable | `entrypoints/content.ts`, `entrypoints/content/*` | Every controller owns explicit state, listeners, observers, timers, and minimal DOM roots; `start/stop` is idempotent; reinjection/navigation cannot duplicate resources; migrated global state and old paths are deleted. |
| T4.3 | Define floating-chat permission and lifecycle state machine | P2 | M | T3.2, T4.2 | B | S, U, E | Extend launcher state/permission/context-invalidated tests | No governance change expected | `entrypoints/floating-chat.content.ts`, `entrypoints/content/adapters/chat-launcher.ts`, `core/platform/chrome-api.ts` | Disabled, enabled-without-permission, ready, and context-invalidated states agree with UI and runtime capability; preserve the user's pre-existing uncommitted launcher work and resolve provenance before editing overlapping lines. |
| T4.4 | Extract Side Panel runtime client and domain controllers | P1 | L | T3.1, T3.2, T3.3, T3.5 | C | S, U, P | Add runtime client, page state, permission, and regression tests | No governance change expected unless a stable UI boundary emerges | `entrypoints/sidepanel/pages/McpPage.tsx`, `ChatPage.tsx`, settings state, runtime response helpers | UI no longer owns transport, permission, or domain policy; all messages use the command map; navigation, pending state, i18n, and visible behavior remain unchanged. |
| T4.5 | Split Shell Host by protocol, router, and provider | P1 | XL | T1.5, T3.5 | D | S, U, P, E, R | Extend protocol, provider, installer, and native smoke tests | Record durable host boundaries in `AGENTS.md` if needed | `packages/shell-host/native/shell-mcp-host.mjs`, new host modules, installer scripts | Framing, JSON-RPC, registry, session/process/file/Skill/picker, and OS adapters are separated; Native envelope, tool list, output, and install paths remain compatible; the old monolithic paths are removed as each provider moves. |

### Parallel Lanes

| Lane | Tasks | Merge Risk | Notes |
|:--|:--|:--|:--|
| A | T4.1 | High | Background is a central integration hotspot. |
| B | T4.2 → T4.3 | High | Only one executor may edit `entrypoints/content.ts`/launcher ownership at a time. |
| C | T4.4 | Medium | Shares messaging/platform contracts; integrate after rebasing on Lane A. |
| D | T4.5 | Low | Native Host is largely isolated. |

## Phase 5: Stability and Compatibility Closure

**Goal**: Standardize failure semantics on migrated paths, delete all strangler remnants, and prove the frozen compatibility registry end to end.

**Prerequisite**: Phase 4 complete.

**S.U.P.E.R Focus**: U, R — one path per behavior and explicit failure instead of hidden fallback.

| ID | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Governance Impact | Primary Surfaces | Acceptance Criteria |
|:--|:--|:--:|:--:|:--|:--:|:--:|:--|:--|:--|:--|
| T5.1 | Make migrated failure semantics observable | P1 | L | T4.1, T4.2, T4.3, T4.4, T4.5 | A | S, U, P | Add fault-path tests for retryable, user-visible, and best-effort classes | Record the explicit-failure policy in `AGENTS.md` if it becomes more specific | All handlers/controllers/ports migrated in this run | Changed paths classify failure and recovery explicitly; empty catches and silent defaults are removed; no new broad fallback or broad catch is introduced; errors carry stable codes/actions where callers need them. |
| T5.2 | Remove legacy paths and close compatibility | P0 | L | T5.1 | A | U, R | Run targeted tests, compile, prompt freeze, all-browser builds, manifest checks, native smoke, and final `ci:quality` | Synchronize durable final invariants to `AGENTS.md`; update tracker | Old dispatchers, validators, duplicate storage truths, dead ports, and dead branches are absent; every Phase 1 registry item links to current evidence; no unmentioned behavior or contract change remains. |

### Parallel Lanes

| Lane | Tasks | Merge Risk | Notes |
|:--|:--|:--|:--|
| A | T5.1 → T5.2 | High | Deliberately serial integration and deletion phase. |

## Phase 6: Measured Performance Optimization

**Goal**: Improve steady-state DOM cost, startup loading, bundle behavior, and persistence write efficiency using before/after evidence while keeping the compatibility closure green.

**Prerequisite**: Phase 5 complete.

**S.U.P.E.R Focus**: S, U, E, R — optimize owned lifecycles and replaceable boundaries, not incidental file size.

| ID | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Governance Impact | Primary Surfaces | Acceptance Criteria |
|:--|:--|:--:|:--:|:--|:--:|:--:|:--|:--|:--|:--|
| T6.1 | Optimize content observers, polling, and teardown | P1 | L | T5.2 | A | S, U, E | Add deterministic mutation/navigation traces and resource-count budgets | Record stable lifecycle/performance budgets in `AGENTS.md` | Content controllers, interceptor route/token adapters | Permanent full-page 500ms polling is removed; observer roots are narrowed and duplicate observers consolidated; controller teardown leaves zero owned listener/observer/timer resources; callback work improves against the recorded baseline without behavior drift. |
| T6.2 | Lazy-initialize Pyodide, bundled Skills, and heavy chunks | P2 | L | T5.2 | B | S, E, R | Add startup-path/bundle assertions and on-demand capability smoke tests | Record stable bundle/startup budgets in `AGENTS.md` | `wxt.config.ts`, sandbox/Python worker, Skill resource loaders, Side Panel lazy boundaries | Pyodide remains distributable offline but initializes only on first Python use; bundled Skill resources and heavy UI code leave the initial execution path; initial chunks do not regress and target chunks improve measurably across all browser builds. |
| T6.3 | Reduce persistence write amplification and concurrent overwrite | P1 | L | T5.2 | C | U, P, R | Add concurrent mutation tests and fixed-burst write/payload measurements | Record durable transaction/write-budget rules in `AGENTS.md` if needed | Usage, tool-history, automation, saved-items, scenario, and sync config/operation coordination | Concurrent mutations do not lose updates; sync actions use the user-confirmed target and cannot overwrite a newer config or publish an older in-process snapshot last; burst-capable paths serialize, transact, or coalesce writes without changing keys/value schemas; a fixed 100-mutation trace writes fewer times/bytes than baseline and preserves exact final state. |

### Parallel Lanes

| Lane | Tasks | Merge Risk | Notes |
|:--|:--|:--|:--|
| A | T6.1 | Medium | Content lifecycle only. |
| B | T6.2 | Medium | Build graph and content startup can overlap Lane A; integrate with fresh bundle measurements. |
| C | T6.3 | Low | Persistence repositories are mostly isolated from DOM/build work. |

## Execution Guardrails

1. Implement one Issue per branch/worktree and PR. Do not mix unrelated cleanup into a task.
2. A task may create a port only if the same diff wires a production consumer and removes the superseded direct dependency.
3. A central hotspot (`entrypoints/background.ts`, `entrypoints/content.ts`, root contracts) has a single integration owner; parallel lanes submit isolated modules and tests before central wiring.
4. Before starting T4.3, re-check the working tree and preserve the current user-owned floating-chat changes byte-for-byte unless the user explicitly folds them into that task.
5. After every task, record adaptive-control telemetry on its Issue and update the Milestone state before starting another task.
