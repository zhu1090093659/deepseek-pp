# DeepSeek++ Project Agent Instructions

## Scope

These instructions apply to the entire repository. `AGENTS.md` is the sole project-level agent instruction truth source for this project.

## Product Context

DeepSeek++ is a WXT/React/TypeScript MV3 browser extension that adds agentic memory, Skills, tools, automation, and related workflows to DeepSeek. Its core runtime model is:

- intercept DeepSeek Web requests and streams from the page runtime;
- augment prompts with memory, Skill, preset, project, and tool context;
- parse tool-call output and execute approved capabilities through extension-owned boundaries;
- persist user state in IndexedDB and browser storage;
- integrate optional MCP, Native Host, sync, sandbox, Side Panel, and floating-chat surfaces.

Chrome, Edge, and Firefox on desktop are the only supported product targets. Android, mobile WebView shells, and mobile packages are outside the current product scope.

## Truth Sources

- `AGENTS.md` — stable project rules, architecture invariants, and recurring engineering constraints.
- `docs/progress/MASTER.md` — active spec-driven run, GitHub Issue/Milestone mapping, and resume point.
- `docs/analysis/project-overview.md` — confirmed scope and compatibility boundary for the active refactor.
- `docs/analysis/module-inventory.md` and `docs/analysis/risk-assessment.md` — current architecture evidence and risk basis.
- `docs/compatibility/README.md` and its linked registries — stable prompt, runtime, persistence, browser, integration, and historical-data contracts for the active refactor.
- `docs/plan/task-breakdown.md` and `docs/plan/dependency-graph.md` — task ownership, dependencies, and execution lanes.
- `package.json`, `wxt.config.ts`, and GitHub workflows — executable build, test, manifest, and release contracts.
- `docs/releases/<version>.md` — exact public release/update notes for that version.

When prose and executable behavior disagree, verify the code and tests, then update the stale document in the same task. Do not create a second source of truth to bridge the mismatch.

## Collaboration Rules

- Once the core scope is aligned, make routine technical decisions and proceed. Ask only when a new choice materially changes behavior, compatibility, risk, or authorization.
- Prefer root-cause structural fixes over symptom patches. Remove duplicate logic, obsolete gates, dead branches, and hidden fallbacks instead of layering another path beside them.
- Keep changes scoped to the active Issue. Preserve unrelated and pre-existing working-tree changes.

## Architecture and Compatibility Invariants

- Preserve prompt byte output, tool XML tags, inline-agent continuation/finalization semantics, and user-visible behavior unless an Issue explicitly authorizes a contract change.
- Preserve storage keys, IndexedDB names/tables/identity, supported schema versions, sync/export records, runtime message names, MAIN/content bridge records, MCP contracts, Native Host contracts, and Chrome/Edge/Firefox degradation semantics.
- Every schema change requires an explicit, deterministic, idempotent migration. Unknown future versions and corrupt data must fail visibly without overwriting the original state.
- Maintain one authoritative router, validator, policy, and persistence truth for each concept. Delete the superseded path as soon as its consumer migrates.
- Define contracts before implementations. Contract modules must not import concrete browser, DOM, provider, or entrypoint implementations.
- Introduce only narrow environment ports. A new port must gain a production consumer in the same task; otherwise remove it. Do not expand the existing broad platform abstraction without a real consumer.
- Cross-runtime and external-I/O contracts must be serializable and validated at the receiving trust boundary.
- Before privileged runtime, Port, MessagePort, or frame dispatch, derive authority only from browser-provided sender, tab, frame, document, WindowProxy, and receiver-owned correlation state, then run the direction-specific codec. Message-declared source, tab, frame, session, or request IDs are routing claims, not identity; MAIN-world payloads remain untrusted. Opaque sandbox `postMessage('*')` is allowed only with exact source/origin checks and strict request correlation.
- Every production tool execution must pass through the runtime authorization path before payload rehydration or provider execution. Page/model calls require a background-owned grant that binds the receiver-owned document/session, advertised descriptor security snapshot, canonical provider/mode/risk, request identity, and one-time call reservation; caller-supplied ToolCall metadata is never authorization evidence.
- Do not add an Android project, mobile WebView bridge, mobile platform kind, build job, test surface, documentation claim, or release path unless the user explicitly reopens that product scope.
- Sync uploads publish all six payloads and their checksum manifest before replacing `sync-current.json`. The current pointer is the only generation commit point: new uploads never dual-write legacy fixed files, and readers may use legacy fixed files only when the pointer is absent. A present but invalid generation must fail visibly.
- Content capabilities own explicit, idempotent `start/stop` lifecycles and all listeners, observers, timers, DOM roots, and mutable state they create.
- Background entrypoints are composition/lifecycle roots; domain behavior belongs in typed handlers and services.
- Do not add broad catches, silent defaults, mock-success paths, or unlogged fallbacks to make failures disappear. Best-effort behavior must be explicit, bounded, and tested.

## Security Baseline

- Never hardcode secrets, API keys, credentials, or tokens.
- Validate and sanitize external input at page, runtime-message, native-host, sync, and network boundaries before privileged work.
- Keep public security Issues limited to repair goals and verifiable outcomes. Detailed trust-boundary or exploit evidence stays in local analysis until disclosure is appropriate.

## Testing and Validation

Behavior, data, security, schema, routing, permission, persistence, caching, and performance changes must add or update relevant automated tests. A pure documentation/config task may use the closest static validation but must record why runtime tests do not apply.

Run applicable validation in this order:

1. Targeted tests for changed behavior.
2. `npm run compile` and applicable static checks.
3. `npm run prompt:freeze` when prompt, tool, Skill, memory, project, or inline-agent behavior may be affected.
   Update prompt goldens only through `npm run prompt:freeze:update`, after the active Issue explicitly authorizes the byte change and the generated diff has been reviewed.
   Keep runtime, bridge, tool-record, and sandbox contract fixtures synchronized with every cross-runtime contract change. Label malformed behavior that is merely accepted today as a `current-gap` with its owning follow-up; never promote it to a legal fixture without an explicit compatibility decision.
   Keep historical IndexedDB, local-storage, and sync fixtures synchronized with every persistence contract change. Data-loss, silent-default, filtered-row, partial-commit, and future-version behavior must remain labeled migration gaps with an owning follow-up; never treat those paths as successful compatibility.
   Keep DeepSeek route/SSE, generated-manifest/capability, MCP/Native envelope, and Shell catalog/installer fixtures synchronized with every external-runtime contract change. Keep accepted-unknown and degraded behavior labeled with an owning follow-up.
4. Affected browser builds; use `npm run build:all` for cross-browser or closure tasks.
5. `npm run verify:manifest-policy` and `npm run verify:extension-utf8` when manifests, assets, permissions, or build output change.
6. The narrow smoke test for the changed runtime, followed by `npm run ci:quality` at compatibility/release closure.

Backend/unit tests use a hard 60-second timeout. After timeout or interruption, verify the process group exited and no orphaned Vitest/test child remains. Starting a server or host is not smoke evidence; exercise at least one real command or tool call.

## Spec-Driven Tracking

- The active refactor uses GitHub Issues + Milestones + PRs in `GITHUB_STANDARD` mode; no Project board is required.
- Filter the active run with both `spec-driven` and `spec:core-refactor-2026-07`.
- Implement one Issue per branch/worktree and PR. Record execution telemetry on the Issue before closing it through the merged PR.
- Update `docs/progress/MASTER.md` when phase status, active task, blockers, GitHub mappings, or the resume point changes.
- Stable rules discovered during execution belong here. Transient findings, task notes, and progress do not.

## Public Documentation Style

README and other user-facing product documentation describe what users can do, not internal endpoints, wire formats, interception details, or architecture internals. Keep public copy natural and product-focused rather than template-heavy.

## Governance

- Do not create or restore a root `CLAUDE.md`; all shared project guidance belongs in `AGENTS.md`.
- Do not create a repo-local memory file. The repository has no approved memory fallback.
- `.claude/settings.local.json` is local command-permission configuration, not a project instruction or memory source.
- If another agent-specific rule surface appears, merge any durable shared guidance into `AGENTS.md` and remove duplication before treating it as authoritative.
