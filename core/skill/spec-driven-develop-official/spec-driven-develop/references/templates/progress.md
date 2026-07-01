# Progress Document Templates

Templates for the tracking documents generated in Phase 4 (Progress Tracking Documentation). Output to `docs/progress/`. Choose the template that matches the detected tracking mode.

---

## MASTER.md — GitHub Mode (GITHUB_FULL / GITHUB_STANDARD)

Use this template when the tracking mode is `GITHUB_FULL` or `GITHUB_STANDARD`. MASTER.md serves as a lightweight local index pointing to GitHub resources. Actual task status lives in GitHub Issues.

```markdown
# [Task Name] — Progress Tracker

> **Task**: One-line description
> **Started**: YYYY-MM-DD
> **Last Updated**: YYYY-MM-DD
> **Mode**: GITHUB_FULL | GITHUB_STANDARD
> **Repo**: owner/repo

## GitHub Resources
- **Project Board**: https://github.com/users/{user}/projects/{num} _(GITHUB_FULL only)_
- **All Issues**: `gh issue list -R {repo} --label "spec-driven" --state all`

## References
- [Project Overview](../analysis/project-overview.md)
- [Module Inventory](../analysis/module-inventory.md)
- [Risk Assessment](../analysis/risk-assessment.md)
- [Task Breakdown](../plan/task-breakdown.md)
- [Dependency Graph](../plan/dependency-graph.md)
- [Milestones](../plan/milestones.md)

## Milestones

| Phase | Name | Milestone URL | Open | Closed | Total |
|:------|:-----|:-------------|-----:|-------:|------:|
| 1     |      | https://github.com/{owner}/{repo}/milestone/1 | N | 0 | N |
| 2     |      | https://github.com/{owner}/{repo}/milestone/2 | N | 0 | N |

## Issue Mapping

| Task ID | Issue | Title | Status |
|:--------|:------|:------|:-------|
| T1.1    | #101  |       | open   |
| T1.2    | #102  |       | open   |

## Quick Status Commands

```bash
# Phase progress (all milestones)
gh api repos/{owner}/{repo}/milestones --jq '.[] | "\(.title): \(.open_issues) open, \(.closed_issues) closed"'

# Open tasks for a phase
gh issue list -R {repo} --milestone "Phase 1: {name}" --state open --json number,title

# All spec-driven Issues
gh issue list -R {repo} --label "spec-driven" --state all --json number,title,state,milestone
```

## Phase Checklist
- [ ] Phase 1: <name> (0/N tasks) — [milestone](https://github.com/{owner}/{repo}/milestone/1)
- [ ] Phase 2: <name> (0/N tasks) — [milestone](https://github.com/{owner}/{repo}/milestone/2)

## Current Status
<!-- Updated by the agent at the start and end of each work session -->
**Active Phase**: Phase N
**Active Task**: Task description (Issue #NNN)
**Blockers**: None / description

## Governance Status
<!-- Updated when project-level agent rules or durable memory change -->
**Shared instruction surface**: `AGENTS.md` / other / unavailable
**Claude Code instruction surface**: `CLAUDE.md` / unavailable
**Other platform rule surfaces**: `.cursor/rules/`, `.windsurf/`, `.clinerules*`, `.codex/`, or none
**Memory surface**: native / existing repo fallback / explicit fallback / unavailable
**Memory fallback path**: none / `<path>`

## Next Steps
<!-- What the agent should do next when resuming in a new conversation -->
1. ...
2. ...

## Session Log
<!-- Append-only log of work sessions -->
| Date | Session | Summary |
|:-----|:--------|:--------|
|      |         |         |
```

---

## MASTER.md — LOCAL_ONLY Mode

Use this template when the tracking mode is `LOCAL_ONLY`. This is the original full-fidelity progress tracking format.

```markdown
# [Task Name] — Progress Tracker

> **Task**: One-line description
> **Started**: YYYY-MM-DD
> **Last Updated**: YYYY-MM-DD
> **Mode**: LOCAL_ONLY

## References
- [Project Overview](../analysis/project-overview.md)
- [Module Inventory](../analysis/module-inventory.md)
- [Risk Assessment](../analysis/risk-assessment.md)
- [Task Breakdown](../plan/task-breakdown.md)
- [Dependency Graph](../plan/dependency-graph.md)
- [Milestones](../plan/milestones.md)

## Phase Summary

| Phase | Name | Tasks | Done | Progress |
|:------|:-----|------:|-----:|:---------|
| 1     |      |     N |    0 |          |
| 2     |      |     N |    0 |          |

## Phase Checklist
- [ ] Phase 1: <name> (0/N tasks) — [details](./phase-1-<name>.md)
- [ ] Phase 2: <name> (0/N tasks) — [details](./phase-2-<name>.md)

## Current Status
<!-- Updated by the agent at the start and end of each work session -->
**Active Phase**: Phase N
**Active Task**: Task description
**Blockers**: None / description

## Governance Status
<!-- Updated when project-level agent rules or durable memory change -->
**Shared instruction surface**: `AGENTS.md` / other / unavailable
**Claude Code instruction surface**: `CLAUDE.md` / unavailable
**Other platform rule surfaces**: `.cursor/rules/`, `.windsurf/`, `.clinerules*`, `.codex/`, or none
**Memory surface**: native / existing repo fallback / explicit fallback / unavailable
**Memory fallback path**: none / `<path>`

## Next Steps
<!-- What the agent should do next when resuming in a new conversation -->
1. ...
2. ...

## Session Log
<!-- Append-only log of work sessions -->
| Date | Session | Summary |
|:-----|:--------|:--------|
|      |         |         |
```

---

## phase-N-\<name\>.md (Per-Phase Detail File — LOCAL_ONLY mode)

In `LOCAL_ONLY` mode, create one per phase. In GitHub modes, these files are optional — the phase's task list lives in GitHub Issues filtered by milestone.

```markdown
# Phase N: <Phase Name>

**Goal**: What this phase achieves
**Status**: Not Started / In Progress / Complete

## Tasks
- [ ] **Task N.1**: Description
  - Priority: P0
  - Effort: M
  - Test Expectation: Add/update relevant automated tests
  - Memory Impact: Update resolved memory surface if a durable rule emerges
  - Acceptance: How to verify this is done
  - Notes: _none yet_
- [ ] **Task N.2**: Description
  - Priority: P1
  - Effort: S
  - Test Expectation: Not applicable: docs-only; run markdown/static validation
  - Memory Impact: None
  - Acceptance: How to verify this is done
  - Notes: _none yet_

## Phase Notes
<!-- Decisions, blockers, context discovered during this phase -->

## Phase Completion Checklist
- [ ] All tasks above are checked off
- [ ] MASTER.md phase count updated
- [ ] MASTER.md "Current Status" updated to next phase
```
