# DeepSeek++ Refactor Risk Assessment

This document is the public risk summary for the `core-refactor-2026-07` run. It identifies repair goals and acceptance direction without publishing exploit paths, sensitive trust-boundary evidence, or credential-bearing examples. Detailed security evidence remains in the local analysis workspace and is not a public project truth source.

## S.U.P.E.R Architecture Health

| Principle | Status | Summary | Transformation priority |
|:--|:--:|:--|:--:|
| S — Single Purpose | At risk | Content, background, Side Panel, interceptor, and Native Host hotspots own multiple domains and lifecycles. | High |
| U — Unidirectional Flow | At risk | Root contracts, tool/provider registration, platform access, and sync composition have reverse or cyclic dependencies. | High |
| P — Ports over Implementation | Partial | Export and transport modules contain useful ports, but runtime, persistence, and environment boundaries are not consistently authoritative. | High |
| E — Environment-Agnostic | At risk | Browser capability/degradation behavior is not yet represented by narrow, authoritative ports with real consumers. | High |
| R — Replaceable Parts | At risk | Replacing protocol, persistence, runtime, or page adapters currently affects unrelated modules. | High |

The refactor therefore starts with compatibility contracts, addresses critical boundaries and failure safety, introduces only narrow ports with real consumers, and then removes superseded paths through a strangler cutover.

## Public Risk Register

| ID | Public risk statement | Impact | Priority | Required public outcome |
|:--|:--|:--:|:--:|:--|
| R-01 | Privileged runtime messages need one validated authorization boundary. | Critical | P0 | Legal calls remain compatible; malformed, unauthorized, stale, replayed, and cross-session calls fail before privileged I/O. |
| R-02 | The unsupported Android template created a second platform and security contract. | Resolved | Closed by #345 | Remove the template, bridge, build, CI, tests, and current-support claims; keep PC Chrome/Edge/Firefox as the only product targets. |
| R-03 | Sync has no generation-level atomic commit or download rollback. | High | P0 | Upload publishes only complete generations; download stages, journals, commits deterministically, and restores the prior state after injected failure. |
| R-04 | Automation timeout is not yet an end-to-end cancellation contract. | High | P0 | Deadline, abort, lease, and supported idempotency context reach request, stream, and tool boundaries; ambiguous external work is not replayed silently. |
| R-05 | Persistence version and migration policy is inconsistent across stores. | High | P1 | Historical data migrates deterministically; corrupt/future data fails visibly without overwrite; each concept converges on one truth source. |
| R-06 | Background and content entrypoints have a large regression and merge radius. | High | P1 | Typed handlers/controllers own one lifecycle and one domain; migrated legacy paths are deleted. |
| R-07 | Long-lived DOM observation and polling have no measured ownership/budget. | High | P1 | Controllers own and fully tear down their resources; callback/startup/write changes are measured against recorded baselines. |
| R-08 | Platform abstractions and actual browser capabilities can drift. | High | P1 | Narrow ports have real consumers; Chrome/Edge/Firefox behavior and explicit unsupported degradation remain green. |
| R-09 | Timeout, cancellation, retry, and body budgets vary by network/runtime path. | High | P1 | Migrated paths use explicit, compatible failure and recovery contracts without hidden fallback. |
| R-10 | Current tests do not cover every migration, fault, or browser-runtime boundary. | High | P1 | Each behavior-changing task adds targeted executable evidence; final closure runs all applicable repository gates. |
| R-11 | Floating-chat permission and lifecycle state can disagree across UI/runtime surfaces. | Medium | P2 | One state machine covers disabled, permission-missing, ready, and context-invalidated behavior while preserving existing user settings. |
| R-12 | Heavy assets and hot runtime paths lack stable performance budgets. | Medium | P2 | Performance work records before/after evidence and keeps every compatibility fixture green. |

## Compatibility and Data-Safety Rules

- Prompt bytes, tool tags, runtime and bridge message names, browser identity, MCP/Native contracts, and user-visible behavior change only through an explicit contract decision.
- Storage keys, IndexedDB names/tables/identity, known schema versions, sync files, and import/export records remain readable.
- Every migration is deterministic and idempotent. Unknown future or corrupt data must remain intact and fail visibly rather than being rewritten as a default.
- Multi-record durability needs an atomic commit point or recovery journal. Partial mutation is not reported as compatible success.
- New validators, routers, permission policies, and persistence paths replace the old source of truth; they do not run indefinitely beside it.

The detailed contract inventory and current gaps are maintained under [`docs/compatibility/README.md`](../compatibility/README.md). Security-sensitive Issues contain only repair objectives and publicly verifiable outcomes.

## Validation Risks

The v1.10.0 baseline passes the current Vitest suite, TypeScript compile, prompt source freeze, Chrome/Edge/Firefox builds, manifest policy, extension UTF-8 policy, and production dependency audit. This does not yet prove:

- real-browser lifecycle behavior;
- historical IndexedDB migrations and future-version protection;
- sync fault recovery and restart idempotency;
- exhaustive runtime/bridge authorization behavior;
- steady-state DOM, startup, bundle, or persistence-write performance.

Those gaps are assigned to the specific tasks in [`docs/plan/task-breakdown.md`](../plan/task-breakdown.md); they are not deferred to an unbounded standalone testing program.

## Governance

- `AGENTS.md` is the sole project-level agent instruction truth source.
- GitHub Issues, Milestones, and PRs track this run; no Project board is used.
- Public security tracking remains generic. Detailed evidence, reproduction chains, and disclosure-sensitive reasoning stay local until an explicit disclosure decision.
- The user's pre-existing floating-chat work is preserved and remains an overlap guard for T4.3.
