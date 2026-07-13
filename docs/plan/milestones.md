# DeepSeek++ Reliability and Compatibility Refactor — Milestones

## Strategy

This run uses `compatibility-firewall + risk-first vertical slices + strangler cutover`. GitHub Milestone descriptions hold the adaptive-control state; GitHub Issues hold task status and per-task telemetry.

| Phase | Milestone | URL | Tasks | Completion Criteria | Adaptive Thresholds | Status |
|:--:|:--|:--|--:|:--|:--|:--|
| 1 | Compatibility Firewall | [#43](https://github.com/zhu1090093659/deepseek-pp/milestone/43) | 5 | Registry complete; prompt/output, runtime/bridge, persistence/sync, and external-runtime contracts have executable evidence without production behavior drift. | annotate 1 / replan 2 / rescope 3 | Pending |
| 2 | Critical Boundaries and Failure Safety | [#44](https://github.com/zhu1090093659/deepseek-pp/milestone/44) | 7 | Privileged message/tool paths reject invalid context; the unsupported Android surface is removed; sync is atomic/recoverable; automation cancellation prevents late side effects. | annotate 2 / replan 3 / rescope 4 | In progress — 3 closed / 4 open |
| 3 | Authoritative Contracts and Real Ports | [#45](https://github.com/zhu1090093659/deepseek-pp/milestone/45) | 5 | Command map, narrow ports, persistence codecs, DeepSeek adapters, and tool registry are production-authoritative; targeted cycles are gone. | annotate 1 / replan 2 / rescope 3 | Pending |
| 4 | Strangler Cutover of Runtime Hotspots | [#46](https://github.com/zhu1090093659/deepseek-pp/milestone/46) | 5 | Background/content are composition roots; floating chat, Side Panel, and Shell Host use extracted owners; migrated legacy paths are removed. | annotate 1 / replan 2 / rescope 3 | Pending |
| 5 | Stability and Compatibility Closure | [#47](https://github.com/zhu1090093659/deepseek-pp/milestone/47) | 2 | Failure semantics are explicit; duplicate/dead paths are absent; every compatibility registry entry has green evidence and the full quality gate passes. | annotate 1 / replan 1 / rescope 2 | Pending |
| 6 | Measured Performance Optimization | [#48](https://github.com/zhu1090093659/deepseek-pp/milestone/48) | 3 | DOM/runtime resource counts, initial loading, bundle behavior, and persistence writes improve against recorded baselines without contract regression. | annotate 1 / replan 2 / rescope 2 | Pending |

## Milestone Exit Gates

1. All milestone Issues are closed by merged PRs or explicitly deferred through adaptive replanning.
2. Each completed Issue contains execution telemetry: estimated/actual effort, S.U.P.E.R score/delta, unplanned dependencies, task drift, and cumulative milestone drift.
3. Targeted tests pass before compile/build checks; backend/unit test processes respect the 60-second hard timeout and leave no orphan processes.
4. Milestone completion never relies on a narrower test run to claim global compatibility. Phase 5 is the first full compatibility-closure gate.
5. Stable new engineering rules are synchronized to `AGENTS.md`; transient progress remains in GitHub and `docs/progress/MASTER.md`.
