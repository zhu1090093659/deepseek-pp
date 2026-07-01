# Project Governance Templates

Templates for project-level instruction surfaces and memory surface resolution generated in Phase 4. Update existing files in place when they already exist. Prefer native project memory; create a repo-local fallback memory file only when the project already declares one or the user explicitly selects it.

---

## AGENTS.md

```markdown
# Project Agent Instructions

## Scope

These instructions apply to the whole repository.

## Truth Sources

- `<path>` — <why this file is authoritative>
- `<path>` — <why this file is authoritative>

## Development Rules

- Follow the existing architecture and naming conventions.
- New features or behavior changes must add or update relevant automated tests.
- If no automated test surface exists, run the closest static/syntax validation and record the limitation.
- Record durable project facts, commands, invariants, and recurring gotchas in the resolved native memory surface when available.
- Do not create a repo-local memory file unless the workflow explicitly records that fallback decision.
- Keep `CLAUDE.md` aligned with this file when agent-facing rules change.

## Validation

- `<test command>`
- `<typecheck/lint/build command>`
- `<smoke command>`
```

---

## CLAUDE.md

```markdown
# Claude Code Instructions

Read `AGENTS.md` first. It is the shared project-level instruction source for Codex, Cursor, Claude Code, and other Markdown-aware coding agents.

Claude Code-specific reminders:

- <Claude Code command, sub-agent, MCP, or worktree instruction>
- <Claude Code-specific validation or workflow note>
- Do not duplicate shared policy here. Put durable cross-agent rules in `AGENTS.md`; use Claude Code's native memory surface for stable project facts when available.
```

---

## Governance Surface Resolution

```markdown
# Governance Surface Resolution

## Instruction Surfaces

| Surface | Status | Role | Notes |
|:--------|:-------|:-----|:------|
| `AGENTS.md` | existing / created / not used | Shared agent rules | |
| `CLAUDE.md` | existing / created / not used | Claude Code-specific rules | |
| `.cursor/rules/` | existing / absent / not touched | Cursor rules | |
| `.windsurf/` | existing / absent / not touched | Windsurf rules | |
| `.clinerules*` | existing / absent / not touched | Cline rules | |
| `.codex/` | existing / absent / not touched | Codex-specific project files | |

## Memory Surface

| Field | Value |
|:------|:------|
| Native memory available | yes / no |
| Resolved memory surface | <native platform memory / existing repo file / explicit fallback path / unavailable> |
| Repo fallback approved | yes / no / not needed |
| Notes | <how durable facts should be recorded> |
```

---

## Optional Repo Fallback Memory File

Use this only when no native memory surface is available and the user explicitly selects a repo-local fallback.

```markdown
# Project Memory

This file stores durable project facts and decisions because no native project memory surface was available or selected. It is not a progress log; active workflow state belongs in `docs/progress/MASTER.md` during a spec-driven run.

## Stable Project Facts

- <fact>

## Durable Engineering Rules

- <rule>

## Recurring Gotchas

- <gotcha and mitigation>
```
