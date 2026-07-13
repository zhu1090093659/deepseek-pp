# DeepSeek++ Reliability and Compatibility Refactor — Dependency Graph

## Critical Path

The critical path is the compatibility registry → runtime contract → message/tool safety → typed command map → tool registry → background/content cutover → compatibility closure → measured optimization. Sync and automation are independent P0 vertical slices that must converge before the background cutover.

```mermaid
flowchart TD
    subgraph P1["Phase 1: Compatibility Firewall"]
        T11["T1.1 Compatibility registry"]
        T11 --> T12["T1.2 Prompt and output goldens"]
        T11 --> T13["T1.3 Runtime and bridge contracts"]
        T11 --> T14["T1.4 Persistence and sync fixtures"]
        T11 --> T15["T1.5 External runtime contracts"]
    end

    subgraph P2["Phase 2: Critical Boundaries"]
        T13 --> T21["T2.1 Message boundary"]
        T15 --> T21
        T21 --> T22["T2.2 Tool authorization context"]
        T12 --> T22
        T15 --> T23["T2.3 Historical Android bridge hardening"]
        T23 --> T23A["T2.3A Remove Android support surface"]
        T14 --> T24["T2.4 Atomic sync upload"]
        T24 --> T25["T2.5 Staged sync rollback"]
        T13 --> T26["T2.6 Automation cancellation"]
        T15 --> T26
    end

    subgraph P3["Phase 3: Authoritative Contracts and Ports"]
        T21 --> T31["T3.1 Runtime command map"]
        T22 --> T31
        T15 --> T32["T3.2 Narrow platform ports"]
        T23A --> T32
        T25 --> T33["T3.3 Persistence codecs and repositories"]
        T32 --> T33
        T26 --> T34["T3.4 DeepSeek protocol and adapters"]
        T32 --> T34
        T31 --> T35["T3.5 Tool registry and cycle split"]
        T32 --> T35
    end

    subgraph P4["Phase 4: Strangler Cutover"]
        T25 --> T41["T4.1 Background domain handlers"]
        T26 --> T41
        T31 --> T41
        T33 --> T41
        T35 --> T41

        T31 --> T42["T4.2 Content lifecycle controllers"]
        T32 --> T42
        T34 --> T42
        T35 --> T42
        T42 --> T43["T4.3 Floating-chat state machine"]

        T31 --> T44["T4.4 Side Panel controllers"]
        T32 --> T44
        T33 --> T44
        T35 --> T44

        T15 --> T45["T4.5 Shell Host split"]
        T35 --> T45
    end

    subgraph P5["Phase 5: Stability and Closure"]
        T41 --> T51["T5.1 Failure semantics"]
        T43 --> T51
        T44 --> T51
        T45 --> T51
        T51 --> T52["T5.2 Legacy removal and closure"]
    end

    subgraph P6["Phase 6: Measured Performance"]
        T52 --> T61["T6.1 DOM lifecycle optimization"]
        T52 --> T62["T6.2 Lazy heavy resources"]
        T52 --> T63["T6.3 Persistence write efficiency"]
    end
```

## Integration Order

| Phase | Parallel Work | Required Serial Merge |
|:--|:--|:--|
| 1 | T1.2, T1.3, T1.4, and T1.5 after T1.1 | Merge contract indexes once after all fixture lanes finish. |
| 2 | Runtime/tool, platform-scope, sync, and automation lanes | T2.1 → T2.2; T2.3 → T2.3A; T2.4 → T2.5; merge runtime/tool before rebasing automation wiring. |
| 3 | Command/tool, platform/persistence, and DeepSeek lanes | T3.1 → T3.5; T3.2 → T3.3; central contract integration last. |
| 4 | Background, content, Side Panel, and Shell Host lanes | Only one owner edits each central entrypoint; T4.2 → T4.3. |
| 5 | None | T5.1 → T5.2; this is the single compatibility-integration lane. |
| 6 | DOM, resource loading, and persistence lanes | Re-run all performance baselines after merging the three lanes. |

## Forbidden Dependency Shapes

- Contract or schema modules importing browser, DOM, provider, or entrypoint implementations.
- A new router running beside the existing background switch after a command has migrated.
- A persistence migration writing both legacy and current stores as peer truth sources.
- A broad platform/service abstraction with no production consumer in the same task.
- More than one concurrent executor editing `entrypoints/background.ts` or `entrypoints/content.ts`.
