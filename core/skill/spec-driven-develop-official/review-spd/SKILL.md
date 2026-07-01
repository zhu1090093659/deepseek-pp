---
name: review-spd
description: >-
  Findings-first code review workflow for AI coding agents. Use when the user asks
  to review uncommitted changes, commits in a date range, or a branch compared to
  the main branch / PR-style diff. Focuses on bugs, regressions, correctness risks,
  missing tests, security/data-safety issues, and other behavior-changing defects.
version: 1.0.1
---

# Review SPD

You are executing the **Review SPD** workflow: a findings-first code review process for changed code. Your primary goal is to identify bugs, regressions, and behavior risks introduced by the changes. Do not turn this into a style review or a broad summary.

## Configuration

| Item | Default | Purpose |
|:-----|:--------|:--------|
| Context script | `scripts/review-context.py` relative to this Review SPD skill directory | Collect stable git context for review targets |
| Default target | Uncommitted changes | Review working tree and staged changes by default |
| Commit range default | Last 3 days | Used only when the user explicitly requests commit/date review without dates |
| PR base | Auto-detect `origin/main`, `origin/master`, then remote default branch | Base for branch-vs-main review |
| Output style | Findings first | Findings ordered by severity before summaries or notes |

References:

- Reviewer sub-agent template: `references/reviewer-template.md`
- Final output format: `references/output-format.md`

## Target Modes

The workflow supports three mutually exclusive review targets:

1. **Uncommitted mode**: Review current uncommitted changes. This is the default.
2. **Commit-range mode**: Review commits in a date range. If the user explicitly asks for commit/date review but gives no range, use the last 3 days.
3. **Branch / PR mode**: Review a branch compared with the main branch or an explicit base branch.

Resolve target conflicts with this priority:

1. If `branch` is specified, use branch / PR mode.
2. Else if `since` or `until` is specified, use commit-range mode.
3. Else use uncommitted mode.

`base` only applies to branch / PR mode.

## Phase 1: Target Resolution

Extract the review target from the user's request.

Examples:

Resolve the context script from the installed Review SPD skill directory, not from the repository being reviewed. Use the packaged script path in commands, for example:

```bash
python <review-spd-skill-dir>/scripts/review-context.py
python <review-spd-skill-dir>/scripts/review-context.py --since "3 days ago"
python <review-spd-skill-dir>/scripts/review-context.py --since 2026-06-28 --until 2026-07-01
python <review-spd-skill-dir>/scripts/review-context.py --branch feature/foo
python <review-spd-skill-dir>/scripts/review-context.py --branch feature/foo --base origin/main
```

When reviewing this repository itself, the convenience wrapper `scripts/review-context.py` is also available.

If the user gives a vague request such as "review this", use uncommitted mode. If the user asks for "recent commits" without dates, use commit-range mode with `--since "3 days ago"`.

## Phase 2: Context Collection

Run the packaged context script while your current working directory is the repository being reviewed. The script changes into that repository's git root before collecting context. It only collects git context; it does not decide whether code is correct.

Read the generated context and identify:

- Review mode and base/head information
- Commit list, if applicable
- Changed files and diff stats
- Added, deleted, renamed, and modified files
- Unified diff sections that need semantic review

If the script reports no changes, stop and say there is nothing to review for the selected target. Do not invent findings.

## Phase 3: Review Planning

Classify the review size before spawning reviewers:

- **Small**: up to 3 changed files or a small localized diff. Cover Correctness and Tests.
- **Medium**: multiple files or behavior-affecting changes. Cover Correctness, Regression/Compatibility, and Tests.
- **Large or high-risk**: broad changes, auth/permissions, persistence, migrations, concurrency, caching, money, security, public APIs, generated code, or config/deployment changes. Add Security/Data Safety and Performance/Concurrency.

Prioritize behavior code, public contracts, data handling, error paths, configuration, persistence, and tests. Deprioritize pure documentation, formatting-only changes, generated files, and lockfile churn unless they affect runtime behavior.

## Phase 4: Sub-Agent Review

If the current platform supports native sub-agents, task agents, or parallel agents, spawn focused reviewers using `references/reviewer-template.md`. If not, perform the same focused reviews sequentially yourself. Lack of sub-agent support must not reduce review coverage.

Recommended reviewer focuses:

- **Correctness / Bug Risk**: logic errors, edge cases, state consistency, exception paths, invalid assumptions.
- **Regression / Compatibility**: changed API contracts, config behavior, data formats, migrations, CLI behavior, backward compatibility where relevant.
- **Tests / Verification**: missing tests for changed behavior, weak assertions, stale tests, untested failure modes.
- **Security / Data Safety**: authorization, validation, injection, secrets, destructive operations, data loss, privacy.
- **Performance / Concurrency**: async races, caching errors, resource leaks, excessive work, ordering bugs.

Tell each reviewer to return only evidence-backed candidate findings for its focus area. Do not ask every reviewer to review everything.

## Phase 5: Finding Consolidation

Merge all reviewer outputs into one findings list.

Rules:

- Findings must be supported by the diff or directly relevant surrounding context.
- Each finding must include a file and line reference when possible.
- Do not report style preferences, speculative rewrites, or generic best practices unless they create a concrete bug risk.
- If evidence is incomplete, move the item to `Questions` or `Residual Risks` instead of `Findings`.
- Deduplicate overlapping findings and keep the clearest impact statement.
- Order by severity: Critical, High, Medium, Low.

Severity guide:

- **Critical**: data loss, security bypass, production outage, irreversible corruption, or severe user impact likely.
- **High**: clear bug/regression in a common or important path.
- **Medium**: bug in an edge path, compatibility break, missing validation, or test gap likely to hide regressions.
- **Low**: minor bug risk, confusing behavior, narrow edge case, or maintainability issue with direct defect potential.

## Phase 6: Final Response

Use `references/output-format.md`. Findings must be the primary focus of the response.

If there are findings, present them first and keep summaries brief. If there are no findings, explicitly state `No findings` and include residual risks or testing gaps.

Never bury a bug finding below a summary.

## Review Discipline

- Think like a code reviewer, not a feature planner.
- Focus on whether the change introduces new bugs.
- Verify claims against code context before reporting.
- Prefer one strong finding over many weak suggestions.
- Do not modify files unless the user explicitly asks you to fix the review findings.
- If tests or builds are needed to validate a suspected issue, mention the exact command or missing coverage.
