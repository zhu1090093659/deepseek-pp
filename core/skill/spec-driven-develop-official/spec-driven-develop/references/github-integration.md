# GitHub Integration Protocol

This document defines how the Spec-Driven Develop workflow integrates with GitHub Issues, Milestones, Labels, Projects, and Pull Requests for task tracking and execution.

---

## Operating Modes

The workflow auto-detects the best available mode via a pre-flight check. The user can also force a specific mode.

| Mode | Requirements | Capabilities |
|:-----|:------------|:-------------|
| **GITHUB_FULL** | `gh` CLI + auth + `project` scope | Issues + Milestones + Labels + Project board + worktree + PR |
| **GITHUB_STANDARD** | `gh` CLI + auth + `repo` scope | Issues + Milestones + Labels + worktree + PR (no board) |
| **LOCAL_ONLY** | None | Original local-file workflow (no GitHub) |

---

## Pre-flight Check

Run this check at the end of Phase 1 (after analysis, before proceeding to Phase 2). Report the detected mode to the user.

```bash
# Step 1: gh CLI exists?
gh --version > /dev/null 2>&1 || { echo "LOCAL_ONLY"; exit; }

# Step 2: Authenticated?
gh auth status > /dev/null 2>&1 || { echo "LOCAL_ONLY"; exit; }

# Step 3: GitHub remote exists?
REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null) || { echo "LOCAL_ONLY"; exit; }

# Step 4: Can access issues?
gh issue list --repo "$REPO" --limit 1 > /dev/null 2>&1 || { echo "LOCAL_ONLY"; exit; }

# Step 5: Can access projects?
gh project list --limit 1 > /dev/null 2>&1 && echo "GITHUB_FULL" || echo "GITHUB_STANDARD"
```

If the detected mode differs from the user's preference, inform them and explain what's missing (e.g., "Project board requires the `project` scope. Run `gh auth refresh -s project` to enable it.").

---

## Resource Mapping

```
Spec-Driven-Develop Run  →  GitHub Project (board)     [GITHUB_FULL only]
├── Phase N               →  Milestone "Phase N: <name>"
│   ├── Task N.1          →  Issue with structured body
│   │   ├── Priority P0   →  Label "priority:P0"
│   │   ├── Size M        →  Label "size:M"
│   │   └── Lane A        →  Label "lane:A"
│   └── Task N.2          →  Issue with structured body
└── Task execution        →  worktree + branch + PR (closes #N)
```

---

## Label Scheme

Create these labels before creating Issues. Use `--force` for idempotency.

```bash
REPO="owner/repo"

# Priority labels
gh label create "priority:P0" --color "d73a4a" --description "Critical — must do first" --repo "$REPO" --force
gh label create "priority:P1" --color "e4e669" --description "Important — do soon" --repo "$REPO" --force
gh label create "priority:P2" --color "0e8a16" --description "Nice to have" --repo "$REPO" --force

# Size labels
gh label create "size:S" --color "c5def5" --description "Small — hours" --repo "$REPO" --force
gh label create "size:M" --color "bfd4f2" --description "Medium — a day" --repo "$REPO" --force
gh label create "size:L" --color "d4c5f9" --description "Large — days" --repo "$REPO" --force
gh label create "size:XL" --color "f9d0c4" --description "Extra large — a week+" --repo "$REPO" --force

# Spec-driven workflow label
gh label create "spec-driven" --color "1d76db" --description "Managed by Spec-Driven Develop workflow" --repo "$REPO" --force
```

Phase labels are created dynamically based on the actual phase names:
```bash
gh label create "phase:1" --color "ededed" --description "Phase 1: <name>" --repo "$REPO" --force
```

Lane labels are created dynamically based on parallel lane assignments:
```bash
gh label create "lane:A" --color "fef2c0" --description "Parallel lane A" --repo "$REPO" --force
```

---

## Milestone Creation

`gh` has no native `milestone create` subcommand. Use the REST API:

```bash
gh api repos/{owner}/{repo}/milestones \
  -f title="Phase 1: Foundation" \
  -f description="Phase 1 goal description" \
  -f state="open"
```

To list milestones: `gh api repos/{owner}/{repo}/milestones --jq '.[].title'`

---

## Issue Body Template

Every task Issue uses this structured body format:

```markdown
## Task: {task_id} — {task_name}

**Phase**: {phase_number} — {phase_name}
**Priority**: {priority} | **Size**: {size} | **Lane**: {lane}
**S.U.P.E.R Drivers**: {principles}
**Test Expectation**: {required_tests_or_explicit_no_test_rationale}
**Memory/Governance Impact**: {memory_or_governance_update_expectation}

### Description
{task_description}

### Acceptance Criteria
- [ ] {criterion_1}
- [ ] {criterion_2}
- [ ] Passes S.U.P.E.R Quick Check for: {principles}
- [ ] Satisfies test expectation: {required_tests_or_explicit_no_test_rationale}
- [ ] Updates the resolved memory or instruction surfaces if durable project knowledge or agent instructions changed

### Affected Files
- `{file_path_1}`
- `{file_path_2}`

### Dependencies
- Depends on: {dependency_issue_refs or "None"}

---
_Managed by [Spec-Driven Develop](https://github.com/zhu1090093659/spec-driven-develop) workflow_
```

Create an Issue with:
```bash
gh issue create \
  --repo "$REPO" \
  --title "[T{task_id}] {task_name}" \
  --body "$ISSUE_BODY" \
  --label "spec-driven,priority:{p},size:{s},phase:{n},lane:{lane}" \
  --milestone "Phase {n}: {phase_name}"
```

Add a 1-second delay between Issue creations to avoid secondary rate limits.

---

## Project Board Setup (GITHUB_FULL only)

### Create Project and Link to Repo

```bash
# Create project (returns project number)
PROJECT_NUM=$(gh project create --owner "@me" --title "Spec: {project_name}" --format json | jq -r '.number')

# Link to repository
gh project link "$PROJECT_NUM" --owner "@me" --repo "$REPO"
```

### Create Custom Fields

```bash
OWNER="@me"

# Priority field (mirrors labels but enables board filtering)
gh project field-create "$PROJECT_NUM" --owner "$OWNER" --name "Priority" --data-type "SINGLE_SELECT" --single-select-options "P0,P1,P2"

# Size field
gh project field-create "$PROJECT_NUM" --owner "$OWNER" --name "Size" --data-type "SINGLE_SELECT" --single-select-options "S,M,L,XL"

# Phase field
gh project field-create "$PROJECT_NUM" --owner "$OWNER" --name "Phase" --data-type "SINGLE_SELECT" --single-select-options "Phase 1,Phase 2,Phase 3"
```

### Add Issues to Project

```bash
# For each created Issue URL:
gh project item-add "$PROJECT_NUM" --owner "$OWNER" --url "$ISSUE_URL"
```

Setting custom field values on items requires GraphQL node IDs. Retrieve them with:
```bash
# Get project ID
PROJECT_ID=$(gh project view "$PROJECT_NUM" --owner "$OWNER" --format json | jq -r '.id')

# Get field IDs
gh project field-list "$PROJECT_NUM" --owner "$OWNER" --format json | jq '.fields[] | {name: .name, id: .id}'

# Get item IDs
gh project item-list "$PROJECT_NUM" --owner "$OWNER" --format json | jq '.items[] | {title: .title, id: .id}'
```

Then set field values:
```bash
gh project item-edit \
  --id "$ITEM_ID" \
  --field-id "$FIELD_ID" \
  --project-id "$PROJECT_ID" \
  --single-select-option-id "$OPTION_ID"
```

If setting custom field values fails, this is non-critical — the Issue Labels already carry the same information (priority, size, phase). Log a warning and continue.

---

## Task Execution Workflow (worktree + PR)

When a task-executor agent receives an Issue to implement:

### 1. Read Task from Issue
```bash
gh issue view {issue_number} --repo "$REPO" --json title,body,labels,milestone
```

### 2. Create Worktree and Branch
The branch name follows the pattern: `task/{issue_number}-{slug}`
```bash
BRANCH="task/{issue_number}-{slug}"
git worktree add ".claude/worktrees/$BRANCH" -b "$BRANCH"
cd ".claude/worktrees/$BRANCH"
```

Or, if the platform provides a native worktree tool (e.g., Claude Code's `EnterWorktree`), use that instead.

### 3. Implement, Test, and Update Governance
Work in the isolated worktree. Follow acceptance criteria, test expectation, and memory/governance impact from the Issue body. Read the resolved instruction and memory surfaces before editing.

### 4. Commit, Push, and Create PR
```bash
git add -A
git commit -m "feat: {task_description} (refs #{issue_number})"
git push -u origin "$BRANCH"

gh pr create \
  --repo "$REPO" \
  --title "[T{task_id}] {task_name}" \
  --body "$(cat <<'EOF'
## Summary
{brief_description_of_changes}

## Task Issue
closes #{issue_number}

## Changes
- {change_1}
- {change_2}

## S.U.P.E.R Review
- [x] Passes S.U.P.E.R Quick Check for: {principles}

## Tests
- {test_commands_and_results}

## Project Governance
- Instruction surfaces: updated / unchanged (list paths or native surfaces)
- Memory surface: updated / unchanged / unavailable / fallback used

---
_Part of [Spec-Driven Develop](https://github.com/zhu1090093659/spec-driven-develop) workflow_
EOF
)"
```

### 5. Comment on Issue
```bash
gh issue comment {issue_number} --repo "$REPO" --body "Implementation complete. PR: #{pr_number}"
```

### 6. Cleanup
After the PR is merged (or if the executor finishes and the orchestrator handles merging):
```bash
git worktree remove ".claude/worktrees/$BRANCH"
```

---

## Reading Progress from GitHub

New-session continuity protocol (when MASTER.md indicates a GitHub mode):

```bash
REPO="owner/repo"

# Get all milestones with completion stats
gh api repos/{owner}/{repo}/milestones --jq '.[] | "\(.title): \(.open_issues) open, \(.closed_issues) closed"'

# Get open tasks for a specific phase
gh issue list --repo "$REPO" --milestone "Phase 1: Foundation" --state open --json number,title

# Get closed tasks for a specific phase
gh issue list --repo "$REPO" --milestone "Phase 1: Foundation" --state closed --json number,title

# Get all spec-driven Issues
gh issue list --repo "$REPO" --label "spec-driven" --state all --json number,title,state,milestone
```

---

## Closing Issues

Issues are closed automatically when their PR is merged (via `closes #N` in the PR body). Do NOT close Issues manually unless the task is cancelled or deferred.

To defer a task:
```bash
gh issue close {issue_number} --repo "$REPO" --reason "not planned" --comment "Deferred: {reason}"
```
