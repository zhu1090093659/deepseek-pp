# DeepSeek++ Reliability and Compatibility Refactor — Dependency Graph

## Current Replanned Critical Path

Phase 2 telemetry triggered adaptive replanning. The current critical path is message/tool safety → typed handler seam → serial Background cutover, while DeepSeek, persistence, platform cleanup, Content, Side Panel, and Shell advance through separate owner lanes. Every task combines its boundary, real consumer, old-path deletion, and evidence.

```mermaid
flowchart TD
    P2["Phase 2 complete: compatibility and failure safety"]

    subgraph P3R["Replanned Phase 3: Authoritative Vertical Contracts"]
        P2 --> R31["R3.1 Typed handler seam"]
        R31 --> R32["R3.2 Tool provider registry"]
        P2 --> R33["R3.3 Active DeepSeek core"]
        R33 --> R34["R3.4 Passive adapter reuse"]
        P2 --> R35["R3.5 Project/Saved/Scenario codecs"]
        R35 --> R310["R3.10 Skill/Preset/History codecs"]
        P2 --> R36["R3.6 Memory/Artifact migration"]
        P2 --> R37["R3.7 Sync confirmed-target fencing"]
        P2 --> R38["R3.8 Automation/Usage/Tool History"]
        P2 --> R39["R3.9 PC capability truth"]
    end

    subgraph P4R["Replanned Phase 4: Runtime Vertical Cutover"]
        R31 --> R41["R4.1 Background persistence/library"]
        R35 --> R41
        R310 --> R41
        R36 --> R41
        R41 --> R42["R4.2 Background MCP/tool/browser"]
        R32 --> R42
        R42 --> R43["R4.3 Background DeepSeek/export"]
        R33 --> R43
        R43 --> R44["R4.4 Background root closure"]
        R37 --> R44
        R38 --> R44

        R31 --> R45["R4.5 Content lifecycle kernel"]
        R34 --> R45
        R39 --> R45
        R45 --> R46["R4.6 Content tool/inline/chat"]
        R32 --> R46
        R46 --> R47["R4.7 Remaining Content controllers"]
        R35 --> R47
        R39 --> R47
        R45 --> R48["R4.8 Floating-chat state"]
        R39 --> R48

        R31 --> R49["R4.9 Side Panel typed client"]
        R39 --> R49
        R49 --> R410["R4.10 MCP/Tools controllers"]
        R32 --> R410
        R410 --> R411["R4.11 Chat/Settings/Library controllers"]
        R35 --> R411
        R37 --> R411

        R32 --> R412["R4.12 Shell framing/router"]
        R412 --> R413["R4.13 Shell providers/installer"]
    end

    subgraph P5R["Replanned Phase 5: Compatibility Closure"]
        R44 --> R51["R5.1 Failure/legacy audit"]
        R47 --> R51
        R48 --> R51
        R411 --> R51
        R413 --> R51
        R51 --> R52["R5.2 PC compatibility closure"]
    end

    subgraph P6R["Replanned Phase 6: Measured Performance"]
        R52 --> R61["R6.1 Content runtime cost"]
        R47 --> R61
        R52 --> R62["R6.2 Pyodide package truth/budget"]
        R52 --> R63["R6.3 Skill lazy resources"]
        R52 --> R64["R6.4 Side Panel lazy chunks"]
        R411 --> R64
        R52 --> R65["R6.5 Persistence burst writes"]
        R37 --> R65
        R38 --> R65
    end
```

## Superseded Pre-Replan Graph

The graph below is retained only to explain the old #322–#336 issue mapping. It is not executable after the Phase 2 adaptive replan.

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

## Current Integration Order

| Phase | Parallel Work | Required Serial Merge |
|:--|:--|:--|
| 1 | T1.2, T1.3, T1.4, and T1.5 after T1.1 | Merge contract indexes once after all fixture lanes finish. |
| 2 | Runtime/tool, platform-scope, sync, and automation lanes | T2.1 → T2.2; T2.3 → T2.3A; T2.4 → T2.5; merge runtime/tool before rebasing automation wiring. |
| 3 | Typed command/tool, DeepSeek, store, sync, and PC capability lanes | R3.1 precedes R3.2; R3.3 precedes R3.4; stores are isolated but shared fixtures require fresh rebases. |
| 4 | Background, Content, Side Panel, and Shell lanes | Each hotspot has exactly one serial owner lane; no two live branches edit the same root. |
| 5 | None | R5.1 audits bounded leftovers; R5.2 runs the full PC compatibility closure. |
| 6 | Content, package, Skill, Side Panel, and persistence lanes | Each task records its own pre-change baseline and reruns compatibility evidence after optimization. |

## Forbidden Dependency Shapes

- Contract or schema modules importing browser, DOM, provider, or entrypoint implementations.
- A new router running beside the existing background switch after a command has migrated.
- A persistence migration writing both legacy and current stores as peer truth sources.
- A broad platform/service abstraction with no production consumer in the same task.
- More than one concurrent executor editing `entrypoints/background.ts` or `entrypoints/content.ts`.
- A performance task claiming improvement without a fixed pre-change input, measurement unit, and reviewed threshold.
