# Governance Surface Resolution

## Instruction Surfaces

| Surface | Status | Role | Notes |
|:--|:--|:--|:--|
| `AGENTS.md` | Canonical | Sole project-level agent instruction source | Converted from a stale generated mirror into a directly maintained Codex-first rule surface on 2026-07-13. |
| `CLAUDE.md` | Absent / not used | None | The root file was already absent and had no Git history, so there was no content to merge or file to delete. It must not be restored as a parallel truth source. |
| `.claude/settings.local.json` | Existing / not a rule surface | Local command permissions | It contains local permissions only and is not authoritative project guidance. |
| `.cursor/rules/` | Absent | None | Not created. |
| `.windsurf/` | Absent | None | Not created. |
| `.clinerules*` | Absent | None | Not created. |
| `.codex/` | Absent | None | Not created; project-specific rules remain in `AGENTS.md`. |

## Memory Surface

| Field | Value |
|:--|:--|
| Native project memory available | No repository-declared native surface |
| Resolved memory surface | Unavailable |
| Repo fallback approved | No |
| Repo fallback path | None |
| Durable project knowledge | Record stable engineering rules in `AGENTS.md`; record active execution state in GitHub and `docs/progress/MASTER.md` |

## Resolution

`AGENTS.md` is authoritative. No project memory fallback or additional agent-specific instruction file will be created. If a future tool generates another rule surface, shared durable content must be merged into `AGENTS.md` and duplication removed before that surface can affect project decisions.
