# Governance Surface Resolution — Archived Snapshot

## Instruction Surfaces

| Surface | Status | Role | Notes |
|:--|:--|:--|:--|
| `AGENTS.md` | Canonical | Sole project-level agent instruction source | Converted from a stale generated mirror into a directly maintained Codex-first rule surface on 2026-07-13. |
| `CLAUDE.md` | Absent / not used | None | The root file was already absent and had no Git history, so there was no content to merge or file to delete. It must not be restored as a parallel truth source. |
| `videos/deepseek-pp-promo/AGENTS.md` | Canonical for its subtree | HyperFrames composition rules | Retains the complete subtree-specific guidance that was previously duplicated byte-for-byte in `videos/deepseek-pp-promo/CLAUDE.md`. |
| `videos/deepseek-pp-promo/CLAUDE.md` | Removed | None | Its content was already identical to the subtree `AGENTS.md`; the duplicate file was removed on 2026-07-13. |
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
| Durable project knowledge | Stable engineering rules remain in root `AGENTS.md`; completed execution state is preserved in GitHub and this archive's `progress/MASTER.md` |

## Resolution

The applicable live `AGENTS.md` remains authoritative at the repository root and in the HyperFrames subtree. `governance/AGENTS.md` is only the completion-time snapshot for this archived run. No project memory fallback or additional agent-specific instruction file was created. If a future tool generates another rule surface, shared durable content must be merged into the applicable live `AGENTS.md` and duplication removed before that surface can affect project decisions.
