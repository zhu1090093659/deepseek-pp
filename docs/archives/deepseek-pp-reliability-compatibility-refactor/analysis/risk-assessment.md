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
| R-03 | Sync remote publication and local apply could expose partial snapshots. | Resolved | Closed by #319 and #320 | Upload publishes only complete checksum-validated generations; download stages, journals, commits deterministically, and restores raw preimages after injected failure or restart. |
| R-04 | Automation timeout previously returned before execution settled and could replay ambiguous work after retry or restart. | Resolved | Closed by #321 | Deadline, abort, persisted/in-process lease, and supported idempotency context reach request, DeepSeek stream, continuation, tool, and MCP boundaries. Authority remains held until settlement; ambiguous work and scheduled occurrences are not replayed. |
| R-05 | Persistence version and migration policy remains inconsistent in the stores not yet migrated. | Partially mitigated by #355, #356, #358, and #380 | P1; remaining owners in compatibility registry | Historical data migrates deterministically; corrupt/future data fails visibly without overwrite; each concept converges on one truth source. |
| R-06 | Background and content entrypoints have a large regression and merge radius. | Mitigated; full gate passed | R4.3–R4.13 + R5.1 implemented | Background has one typed registry and extracted services; Content has one epoch/resource lifecycle; Shell and Side Panel have explicit composition/controller boundaries. Migrated legacy paths are absent, paired-controller tests prove MAIN-only and isolated-only bridge restart, and the complete integrated matrix passes. |
| R-07 | Long-lived DOM observation and polling have no measured ownership/budget. | Resolved in batch implementation | R4.5–R4.7 + R6.1 | Content teardown returns the resource ledger to zero; two permanent 500ms route pollers are removed; fixed mutation/navigation traces enforce the callback baseline. |
| R-08 | Platform abstractions and actual browser capabilities can drift. | Mitigated; all-browser artifact gate passed | #359 + R4.7–R4.11 + R5.2 | No dead broad facade exists; every new narrow port has a production consumer; typed Side Panel/floating-chat degradation preserves Chrome/Edge/Firefox behavior, and all three build/zip/package contracts pass. |
| R-09 | Timeout, cancellation, retry, and body budgets vary by network/runtime path. | Resolved for active and passive DeepSeek paths | Closed by #353 and #354 | Active Web, Official API, export, passive Fetch/XHR, automation, continuation, and tool paths reuse the frozen codecs/policy and preserve ambiguous-outcome rules. |
| R-10 | Current tests do not cover every migration, fault, or browser-runtime boundary. | Mitigated; integrated matrix passed | R5.2 / #374 | The 161-file / 1,166-test suite plus fault/resource/performance/build/package/smoke gates pass. A real Chrome Content smoke remains unexecuted because Chrome 150 did not load the command-line unpacked extension; no pass is claimed. |
| R-11 | Floating-chat permission and lifecycle state can disagree across UI/runtime surfaces. | Resolved in batch implementation | R4.8 / #367 | One state machine covers disabled, permission-missing, ready, and context-invalidated behavior; launcher DOM/drag/BFCache cleanup is idempotent. |
| R-12 | Heavy assets and hot runtime paths lack stable performance budgets. | Resolved in batch implementation | R6.1–R6.5 | CI now enforces Content traces, exact Pyodide/Skill package inventories, Side Panel chunk ceilings, and persistence burst-write budgets. |

## Compatibility and Data-Safety Rules

- Prompt bytes, tool tags, runtime and bridge message names, browser identity, MCP/Native contracts, and user-visible behavior change only through an explicit contract decision.
- Storage keys, IndexedDB names/tables/identity, known schema versions, sync files, and import/export records remain readable.
- Every migration is deterministic and idempotent. Unknown future or corrupt data must remain intact and fail visibly rather than being rewritten as a default.
- Multi-record durability needs an atomic commit point or recovery journal. Partial mutation is not reported as compatible success.
- New validators, routers, permission policies, and persistence paths replace the old source of truth; they do not run indefinitely beside it.

The detailed contract inventory and current gaps are maintained under [`docs/compatibility/README.md`](../../../compatibility/README.md). Security-sensitive Issues contain only repair objectives and publicly verifiable outcomes.

## Validation Risks

The batch implementation passes the complete PC-only `ci:quality` matrix: 161 test files / 1,166 tests, TypeScript, prompt freeze, workflow/audit/i18n/automation checks, MCP/Shell/PoW smoke, Chrome/Edge/Firefox builds and zips, exact package inventories, manifest/UTF-8 policy, release assets, persistence budgets, and offline Pyodide. Remaining evidence limits are:

- real-browser lifecycle behavior;
- real-browser Content lifecycle behavior with an unpacked extension actually loaded;
- real-browser service-worker termination during sync recovery beyond the existing restart/fault harness;
- store submission/runtime behavior outside the exact built/zip asset checks.

Those gaps are assigned to the specific tasks in [`docs/plan/task-breakdown.md`](../plan/task-breakdown.md); they are not deferred to an unbounded standalone testing program.

## Governance

- `AGENTS.md` is the sole project-level agent instruction truth source.
- GitHub Issues, Milestones, and PRs track this run; no Project board is used.
- Public security tracking remains generic. Detailed evidence, reproduction chains, and disclosure-sensitive reasoning stay local until an explicit disclosure decision.
- The user's pre-existing floating-chat invalidation changes were preserved and integrated into R4.8; the original dirty worktree remains untouched.
