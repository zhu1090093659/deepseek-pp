# Adaptive Control Protocol

This protocol introduces closed-loop feedback control into the Spec-Driven Develop workflow. It defines how execution telemetry is collected, how plan-vs-reality drift is measured, and what automatic corrective actions are taken when drift exceeds thresholds.

---

## Core Concepts

The workflow is modeled as a **closed-loop control system**:

| Control Theory Concept | Workflow Mapping |
|:-----------------------|:-----------------|
| **Plant** (被控对象) | The codebase under transformation |
| **Set point** (目标) | Phase 2 confirmed task definition + S.U.P.E.R principles |
| **Controller** | The SKILL workflow (Phases 0-7) + this adaptive protocol |
| **Actuator** | Task executor agents (sequential or parallel) |
| **Sensor** | Post-task telemetry collection |
| **Error signal** | `drift_score` — cumulative plan-vs-reality deviation |

---

## 1. Execution Observer — Telemetry Collection

After completing every task and BEFORE marking it as done, the agent MUST collect three signals:

### 1.1 Actual Effort

Compare estimated effort (from `task-breakdown.md`) against actual effort:

| Level | Criteria |
|:------|:---------|
| S | Completed in < 30 minutes, no unexpected issues |
| M | 30 min – 2 hours, minor surprises |
| L | 2 – 4 hours, or significant unexpected complexity |
| XL | > 4 hours, or required fundamental re-thinking of approach |

Record the **effort delta** as the number of levels between estimated and actual:
- Estimated M, Actual M → delta = 0
- Estimated S, Actual L → delta = +2
- Estimated L, Actual M → delta = -1

### 1.2 S.U.P.E.R Score Delta

Run the S.U.P.E.R Code Review Checklist (10 checks). Compare the pass count against the task's baseline expectation:
- If the task's S.U.P.E.R drivers indicated it should improve specific principles, and the checklist shows improvement → delta = positive
- If the checklist shows no improvement where improvement was expected → delta = 0 (counts as deviation)
- If the checklist shows regression → delta = negative

Simplified scoring: count passes out of 10. Record `super_score` (0-10) and `super_delta` (change vs. pre-task state).

### 1.3 Unplanned Dependencies

Count the number of dependencies discovered during execution that were NOT listed in the task's "Dependencies" field in `task-breakdown.md`. This includes:
- Files that needed modification but weren't listed in "Affected Files"
- Tasks that should have been prerequisites but weren't identified
- External libraries or APIs that needed changes

---

## 2. Deviation Evaluator — Drift Score Calculation

### 2.1 Per-Task Drift Contribution

Each completed task contributes to `drift_score` based on:

```
task_drift = max(0, effort_delta) + (1 if super_delta <= 0 AND task had SUPER drivers else 0) + min(unplanned_deps, 2)
```

- `effort_delta`: only positive deltas count (underestimates are deviation; overestimates are not)
- S.U.P.E.R stagnation: +1 if a task that was supposed to improve S.U.P.E.R scores didn't
- Unplanned deps: capped at 2 per task to prevent single outlier from dominating

### 2.2 Cumulative Drift Score

```
drift_score = sum of all task_drift values for completed tasks
```

### 2.3 Percentage-Based Thresholds

Thresholds are calculated relative to the **total number of tasks in the current phase**:

```
threshold_annotate = ceil(total_tasks * 0.20)  # 20% — mild adjustment
threshold_replan   = ceil(total_tasks * 0.40)  # 40% — re-decompose remaining tasks
threshold_rescope  = ceil(total_tasks * 0.60)  # 60% — re-evaluate scope with user
```

For example, a phase with 10 tasks: annotate at drift ≥ 2, replan at drift ≥ 4, rescope at drift ≥ 6.

Thresholds are computed once at phase start (when total task count is known) and stored in the adaptive state.

---

## 3. Strategy Adjuster — Automatic Response Actions

### 3.1 Level 1: Annotate (drift ≥ threshold_annotate)

**Trigger**: Mild deviation detected. Plan is still viable but needs attention.

**Automatic actions**:
1. Add label `⚠️-drift-warning` to the next pending Issue (GitHub modes)
2. Post a comment on the next pending Issue:
   ```
   ⚠️ Adaptive Control Notice: drift_score={n}/{threshold_replan}.
   Previous tasks ran harder than estimated. Expect higher complexity.
   Adjust time expectations for this task accordingly.
   ```
3. In LOCAL_ONLY mode: append a warning line to the next task's entry in the phase file
4. Update the adaptive state (see § 4)

### 3.2 Level 2: Replan (drift ≥ threshold_replan)

**Trigger**: Significant deviation. The remaining task decomposition is likely inaccurate.

**Automatic actions**:
1. **HALT current execution** — do not start the next task
2. Post a summary Issue comment or annotation:
   ```
   🔄 Adaptive Control: Replanning triggered (drift_score={n}).
   Remaining tasks will be re-decomposed based on execution learnings.
   ```
3. Close all remaining unstarted Issues with label `superseded-by-replan` and reason `not_planned` (GitHub modes)
4. **Re-enter Phase 3** (Task Decomposition) for the remaining scope only:
   - Use completed task telemetry as input (actual effort levels inform new estimates)
   - Preserve completed tasks and their Issues — only re-plan what's left
   - Create new Issues for the re-decomposed tasks under the same Milestone
5. Reset `drift_score` to 0 for the re-planned segment
6. In LOCAL_ONLY mode: archive old phase file entries and create new ones

### 3.3 Level 3: Rescope (drift ≥ threshold_rescope)

**Trigger**: Severe deviation. The original scope or strategy may be fundamentally wrong.

**Automatic actions**:
1. **HALT current execution**
2. Create a dedicated Issue titled `🔄 Scope Re-evaluation Required`:
   ```
   ## Adaptive Control: Scope Re-evaluation

   drift_score has reached {n}, exceeding the rescope threshold of {threshold}.

   ### Execution Summary
   | Metric | Value |
   |--------|-------|
   | Tasks completed | X/Y |
   | Average effort delta | +Z levels |
   | SUPER improvement rate | N% |
   | Unplanned dependencies | W total |

   ### Recommendation
   The current scope/strategy appears misaligned with project reality.
   Returning to Phase 2 for scope confirmation with the user.
   ```
3. Add label `blocked:replan` to all in-progress Issues
4. **Re-enter Phase 2** (Intent Refinement) with accumulated execution data as context
5. After user re-confirms scope, re-enter Phase 3 to re-decompose all remaining work
6. In LOCAL_ONLY mode: same flow but using MASTER.md annotations

---

## 4. Adaptive State Storage

### 4.1 GitHub Modes (GITHUB_FULL / GITHUB_STANDARD)

**Primary storage**: Milestone description (appended YAML block)

After creating a Milestone in Phase 3, append this block to its description:

```yaml
---
# Adaptive Control State
adaptive:
  drift_score: 0
  strategy: "<decomposition-strategy>"
  thresholds:
    annotate: <computed>
    replan: <computed>
    rescope: <computed>
  total_tasks: <count>
  completed_tasks: 0
  last_updated: "<ISO-8601>"
```

**Update command** (replace the YAML block in Milestone description):
```bash
# Read current description
DESC=$(gh api repos/{owner}/{repo}/milestones/{number} --jq '.description')
# Update the adaptive block (using sed or script)
# Write back
gh api repos/{owner}/{repo}/milestones/{number} -X PATCH -f description="$NEW_DESC"
```

**Per-task telemetry**: Stored as structured Issue comments (see § 4.3).

### 4.2 LOCAL_ONLY Mode

**Primary storage**: `docs/progress/MASTER.md` — dedicated "Adaptive Control State" section:

```markdown
## Adaptive Control State

| Field | Value |
|-------|-------|
| drift_score | 0 |
| strategy | bottom-up |
| threshold_annotate | 2 |
| threshold_replan | 4 |
| threshold_rescope | 6 |
| total_tasks | 10 |
| completed_tasks | 0 |
| last_updated | 2026-05-17 |

### Task Telemetry Log

| Task ID | Est. | Actual | Δ Effort | SUPER Score | SUPER Δ | Unplanned Deps | Task Drift |
|---------|------|--------|----------|-------------|---------|----------------|------------|
```

### 4.3 Issue Telemetry Comment Format (GitHub Modes)

When a task is completed, post this structured comment on the Issue BEFORE closing it:

```markdown
## 📊 Execution Telemetry

| Metric | Estimated | Actual |
|--------|-----------|--------|
| Effort | {est} | {actual} |
| SUPER Score | — | {score}/10 |
| Unplanned Deps | 0 | {count} |

**Deltas**: effort {+/-n}, SUPER {+/-n}, deps +{n}
**Task drift contribution**: {task_drift}
**Cumulative drift_score**: {drift_score} (thresholds: annotate={a}, replan={r}, rescope={s})
```

---

## 5. Controller Activation

### 5.1 Session Start (Cross-Conversation Continuity)

At the start of every conversation, AFTER reading MASTER.md:

1. Read the active Milestone's adaptive state:
   - GitHub modes: `gh api repos/{owner}/{repo}/milestones/{number} --jq '.description'`
   - LOCAL_ONLY: read from MASTER.md "Adaptive Control State" section
2. Parse `drift_score` and thresholds
3. **Evaluate**: If `drift_score` already exceeds a threshold (from a previous session), trigger the appropriate response BEFORE executing any new task
4. Report the adaptive state in the session's opening status

### 5.2 Post-Task (Inline During Execution)

After every task completion:

1. Collect telemetry (§ 1)
2. Calculate task drift contribution (§ 2.1)
3. Update cumulative drift_score (§ 2.2)
4. Write telemetry to Issue comment / MASTER.md (§ 4)
5. Update Milestone adaptive state / MASTER.md (§ 4)
6. **Evaluate**: Check drift_score against thresholds (§ 3)
7. If threshold exceeded → execute response action BEFORE starting next task
8. If no threshold exceeded → proceed to next task

### 5.3 Post-Parallel-Merge (After Consolidating Parallel Results)

After merging parallel lane results:

1. Sum drift contributions from all tasks completed in this parallel batch
2. Update cumulative drift_score
3. Evaluate thresholds against the new cumulative score
4. If threshold exceeded → trigger response before starting next phase

---

## 6. Interaction with Existing Workflow

| Workflow Phase | Adaptive Control Integration |
|:---------------|:-----------------------------|
| Phase 3 (Decomposition) | Initialize adaptive state in Milestone description. Compute thresholds. |
| Phase 4 (Progress Tracking) | MASTER.md template includes telemetry section (LOCAL_ONLY) or telemetry reference (GitHub modes) |
| Phase 5 (Confirm & Execute) | Every task completion triggers § 5.2. Every parallel merge triggers § 5.3. |
| Phase 6 (Archive) | Archive includes final telemetry summary and drift history as execution retrospective. |
