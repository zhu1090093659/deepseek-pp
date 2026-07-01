# Plan Document Templates

Templates for the three documents generated in Phase 3 (Task Decomposition). Output to `docs/plan/`.

---

## task-breakdown.md

```markdown
# Task Breakdown

## Overview
- **Total Phases**: N
- **Total Tasks**: N
- **Estimated Total Effort**: S/M/L/XL

## S.U.P.E.R Design Constraints

> All tasks in this plan must produce code that conforms to S.U.P.E.R architecture principles. The following constraints apply globally:

- **S (Single Purpose)**: Each new module/file/function solves exactly one problem. If a task spans multiple responsibilities, decompose it further.
- **U (Unidirectional Flow)**: Data flows input → processing → output. Dependencies point inward. No circular imports.
- **P (Ports over Implementation)**: Define interface contracts (schemas, types) before implementation. All cross-module I/O must be serializable.
- **E (Environment-Agnostic)**: No hardcoded config. All env-specific values from environment variables or config files.
- **R (Replaceable Parts)**: Each component must be replaceable without cascading changes. Validate with the replacement test: "Can I swap this with a different implementation by only touching this module?"

## Testing and Governance Constraints

> These constraints apply to every task unless the task explicitly states why they are not applicable.

- **Tests by default**: Feature work, behavior changes, API/schema/migration changes, parsing, routing, permissions, caching, and persistence changes must add or update relevant automated tests.
- **Explicit test exemption**: Pure documentation/config tasks may mark tests as not applicable, but the acceptance criteria must explain why and name the closest validation command to run.
- **Agent instruction updates**: If a task changes how future agents must work in the repository, update the resolved instruction surfaces such as `AGENTS.md`, `CLAUDE.md`, or existing platform rule files.
- **Memory updates**: If a task introduces a durable rule, invariant, recurring gotcha, command, or project convention, update the resolved native memory surface or explicitly selected repo fallback.

## Phase 1: <Phase Name>
**Goal**: What this phase achieves
**Prerequisite**: What must be done before this phase
**S.U.P.E.R Focus**: Which S.U.P.E.R principles are most relevant to this phase (e.g., "P — defining interface contracts before implementing modules")

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:-----|:----------|:-----------------|:--------------|:--------------------|
| 1 |      | P0       | M      | —          | A    | S, P      | Add/update tests | Update resolved memory surface if new invariant emerges |                     |
| 2 |      | P1       | S      | —          | B    | U, E      | Not applicable: docs-only | None |                     |
| 3 |      | P1       | S      | 1          | A    | R         | Add/update regression tests | Update resolved instruction surfaces if workflow rule changes |                     |

> **S.U.P.E.R column**: Lists which S.U.P.E.R principles are the primary design drivers for this task. The agent implementing this task must pay special attention to these principles. Every task's acceptance criteria implicitly includes: "Passes the S.U.P.E.R Quick Check for the listed principles."
> **Test Expectation column**: Must name the expected test work or the explicit no-test rationale plus closest validation command.
> **Memory Impact column**: Must state whether the task can affect the resolved memory surface or any resolved instruction surface.

### Parallel Lanes
| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:-----|:------|:----------------|:-----------|:----------|
| A    | 1, 3  | M               | Low        |           |
| B    | 2     | S               | Low        |           |

> Tasks in different lanes have no mutual dependencies and can be executed simultaneously by separate `task-executor` sub-agents. Merge risk indicates the likelihood of file conflicts between lanes.

## Phase 2: <Phase Name>
<!-- Same structure as Phase 1 -->
```

---

## dependency-graph.md

````markdown
# Task Dependency Graph

```mermaid
graph TD
    subgraph Phase1 [Phase 1: Foundation]
        T1_1[Task 1.1: Description]
        T1_2[Task 1.2: Description]
        T1_1 --> T1_2
    end

    subgraph Phase2 [Phase 2: Core]
        T2_1[Task 2.1: Description]
        T2_2[Task 2.2: Description]
    end

    Phase1 --> Phase2
```
````

---

## milestones.md

```markdown
# Milestones

| # | Milestone | Target Phase | Criteria | Status |
|:--|:----------|:-------------|:---------|:-------|
| 1 |           | After Phase 1|          | Pending |
| 2 |           | After Phase 3|          | Pending |
```
