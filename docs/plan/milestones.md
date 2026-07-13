# DeepSeek++ Reliability and Compatibility Refactor — Milestones

## Strategy

This run uses `PC-browser compatibility firewall + telemetry-corrected vertical slices + strangler cutover`. Phase 2 reached its replan threshold at `drift_score=3`; completed work remains fixed and the unstarted #322–#336 plan is replaced by R3.1–R6.5. GitHub Milestone descriptions hold adaptive state; GitHub Issues hold task status and per-task telemetry.

| Phase | Milestone | URL | Tasks | Completion Criteria | Adaptive Thresholds | Status |
|:--:|:--|:--|--:|:--|:--|:--|
| 1 | Compatibility Firewall | [#43](https://github.com/zhu1090093659/deepseek-pp/milestone/43) | 5 | Registry complete; prompt/output, runtime/bridge, persistence/sync, and external-runtime contracts have executable evidence without production behavior drift. | annotate 1 / replan 2 / rescope 3 | Complete — 5/5 |
| 2 | Critical Boundaries and Failure Safety | [#44](https://github.com/zhu1090093659/deepseek-pp/milestone/44) | 7 | Privileged message/tool paths reject invalid context; the unsupported Android surface is removed; sync is atomic/recoverable; automation cancellation prevents late side effects. | annotate 2 / replan 3 / rescope 5 | Complete — 7/7; replan triggered at drift 3 |
| 3 | Authoritative Contracts and Real Ports | [#45](https://github.com/zhu1090093659/deepseek-pp/milestone/45) | 10 | Typed handler seam, real provider/network/storage ports, versioned persistence, sync/action fencing, and PC capability truth are authoritative before hotspot movement. | annotate 2 / replan 4 / rescope 6 | Replanned — pending |
| 4 | Strangler Cutover of Runtime Hotspots | [#46](https://github.com/zhu1090093659/deepseek-pp/milestone/46) | 13 | Background/content are composition roots; floating chat, Side Panel, and Shell Host use serial owner lanes; migrated legacy paths are removed per slice. | annotate 3 / replan 6 / rescope 8 | Replanned — pending |
| 5 | Stability and Compatibility Closure | [#47](https://github.com/zhu1090093659/deepseek-pp/milestone/47) | 2 | Failure semantics are explicit; duplicate/dead paths are absent; every compatibility registry entry has green evidence and the full quality gate passes. | annotate 1 / replan 1 / rescope 2 | Replanned — pending |
| 6 | Measured Performance Optimization | [#48](https://github.com/zhu1090093659/deepseek-pp/milestone/48) | 5 | Content runtime, Pyodide packaging, Skill loading, Side Panel chunks, and persistence burst writes improve against task-local baselines without contract regression. | annotate 1 / replan 2 / rescope 3 | Replanned — pending |

## Milestone Exit Gates

1. All milestone Issues are closed by merged PRs or explicitly deferred through adaptive replanning.
2. Each completed Issue contains execution telemetry: estimated/actual effort, S.U.P.E.R score/delta, unplanned dependencies, task drift, and cumulative milestone drift.
3. Targeted tests pass before compile/build checks; backend/unit test processes respect the 60-second hard timeout and leave no orphan processes.
4. Milestone completion never relies on a narrower test run to claim global compatibility. Phase 5 is the first full compatibility-closure gate.
5. Stable new engineering rules are synchronized to `AGENTS.md`; transient progress remains in GitHub and `docs/progress/MASTER.md`.
