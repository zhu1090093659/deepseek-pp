## Milestones

| Phase | Milestone | Target criteria | Status |
|:--|:--|:--|:--|
| 1 | Browser target packages | Chrome, Edge, and Firefox MV3 package definitions are explicit and reproducible. | Complete |
| 2 | Runtime compatibility | Browser-specific APIs are gated at runtime boundaries. | Complete |
| 3 | Verification and docs | Install docs, builds, smoke checks, and Firefox lint support the new targets. | Complete |

### Adaptive Control State

```yaml
adaptive:
  drift_score: 0
  strategy: "single-codebase browser-target compatibility"
  thresholds:
    annotate: 1
    replan: 2
    rescope: 4
  total_tasks: 6
  completed_tasks: 6
  last_updated: "2026-05-25T00:00:00+08:00"
```
