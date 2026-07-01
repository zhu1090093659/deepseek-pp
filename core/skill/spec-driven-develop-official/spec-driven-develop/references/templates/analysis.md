# Analysis Document Templates

Templates for the three documents generated in Phase 1 (Deep Project Analysis). Output to `docs/analysis/`. These documents serve dual purpose: they feed into Phase 2 (Intent Refinement & Confirmation) for grounded user discussion, and into Phase 3 (Task Decomposition) for planning.

---

## project-overview.md

```markdown
# Project Overview

## Preliminary Direction
<!-- One-sentence summary of the intended transformation direction from Phase 0. This will be refined into a confirmed task definition in Phase 2 after the user reviews this analysis. -->

## Current Architecture
<!-- High-level architecture diagram (Mermaid) and description -->

## Technology Stack
| Layer        | Current          | Target           |
|:-------------|:-----------------|:-----------------|
| Language     |                  |                  |
| Framework    |                  |                  |
| Build Tool   |                  |                  |
| Package Mgr  |                  |                  |
| Database     |                  |                  |
| Deployment   |                  |                  |

## Entry Points
<!-- List of main entry points: CLI commands, API endpoints, UI routes, etc. -->

## Build & Run
<!-- How to build, test, and run the project currently -->

## Testing Baseline
<!-- Existing test frameworks, test commands, coverage gaps, and whether new feature work currently has a reliable place to add tests -->

## Project Governance Baseline
<!-- Existing project-level instruction and memory surfaces: AGENTS.md, CLAUDE.md, native project memory, repo-local fallback memory files, Cursor/Windsurf/Cline/Codex rules, or equivalents. Note canonical locations, gaps, and conflicts. -->

## External Integrations
<!-- APIs, databases, services, file systems the project interacts with -->
```

---

## module-inventory.md

```markdown
# Module Inventory

| Module | Responsibility | Dependencies | Files | Lines | Complexity | S.U.P.E.R Score |
|:-------|:---------------|:-------------|------:|------:|:-----------|:----------------|
|        |                |              |       |       |            |                 |

> **S.U.P.E.R Score**: Rate each module as 🟢 (compliant), 🟡 (partial), or 🔴 (violation) based on the five principles. Format: `S🟢 U🟡 P🔴 E🟢 R🟡`

## Module Details

### <Module Name>
- **Path**: `src/module_name/`
- **Responsibility**: What this module does
- **Public API**: Key functions/classes exposed to other modules
- **Internal Dependencies**: Which other project modules it imports
- **External Dependencies**: Third-party libraries it uses
- **Complexity Rating**: Low / Medium / High / Critical
- **Transformation Notes**: Specific challenges or considerations for this module
- **S.U.P.E.R Assessment**:
  - **S (Single Purpose)**: Does this module have exactly one responsibility? If not, what should be split?
  - **U (Unidirectional Flow)**: Are dependencies one-directional? Any circular dependencies?
  - **P (Ports over Implementation)**: Are inputs/outputs schema-defined and serializable? Are module boundaries contract-based?
  - **E (Environment-Agnostic)**: Any hardcoded paths, embedded config, or platform-specific assumptions?
  - **R (Replaceable Parts)**: Can this module be swapped without cascading changes? What is the replacement cost?
```

---

## risk-assessment.md

```markdown
# Risk Assessment

## S.U.P.E.R Architecture Health Summary

> Evaluate the current codebase against S.U.P.E.R principles to identify architectural risks and guide the transformation.

| Principle | Status | Key Findings | Transformation Priority |
|:----------|:-------|:-------------|:------------------------|
| **S** Single Purpose | 🟢/🟡/🔴 | | High / Medium / Low |
| **U** Unidirectional Flow | 🟢/🟡/🔴 | | High / Medium / Low |
| **P** Ports over Implementation | 🟢/🟡/🔴 | | High / Medium / Low |
| **E** Environment-Agnostic | 🟢/🟡/🔴 | | High / Medium / Low |
| **R** Replaceable Parts | 🟢/🟡/🔴 | | High / Medium / Low |

**Overall Health**: _X/5 principles healthy_ — [Healthy / Refactoring Needed / Technical Debt Alert]

### S.U.P.E.R Violation Hotspots
<!-- List the top modules/files that violate the most S.U.P.E.R principles, ranked by severity. These become priority targets in the transformation plan. -->

## Risk Matrix

| Risk | Impact | Likelihood | Severity | Mitigation |
|:-----|:-------|:-----------|:---------|:-----------|
|      |        |            |          |            |

## High-Severity Risks
<!-- Detailed discussion of each high-severity risk -->

## Technical Debt
<!-- Pre-existing issues that may complicate the transformation. Include S.U.P.E.R violations as a category of technical debt. -->

## Testing Risks
<!-- Missing test harnesses, weak regression coverage, slow/flaky tests, or areas where feature work cannot be safely validated yet. -->

## Project Governance Risks
<!-- Missing or conflicting instruction/memory surfaces, stale instructions, non-native fallback files used without confirmation, or durable decisions that currently exist only in conversation context. -->

## Compatibility Concerns
<!-- API compatibility, data format changes, deployment changes -->
```
