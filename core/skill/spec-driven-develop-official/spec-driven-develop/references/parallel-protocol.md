# Parallel Execution Protocol

This protocol defines how the generated sub-SKILL (and the agent using it) should leverage sub-agents during actual development work. It applies throughout the implementation, not to a specific phase.

---

## When to Parallelize

At the start of each development phase, consult `docs/plan/task-breakdown.md` for parallel lane assignments:
- If a phase has **multiple parallel lanes**, launch one `task-executor` sub-agent per lane simultaneously
- If a phase has **only one lane** (all tasks are sequential), execute tasks one by one — do not force parallelism
- If the platform does not support sub-agents, execute all tasks sequentially yourself

---

## How to Launch Parallel Task Executors

For each parallel lane in the current phase:

1. Prepare the input for each `task-executor` agent:
   - Task ID and description from the plan
   - **Tracking mode** (`GITHUB_FULL`, `GITHUB_STANDARD`, or `LOCAL_ONLY`)
   - **GitHub Issue number** (GitHub modes) or inline task description (LOCAL_ONLY)
   - Acceptance criteria
   - Test expectation and explicit no-test rationale, if any
   - Memory/governance impact and expected surface updates, if any
   - Relevant source file paths (from `docs/analysis/module-inventory.md`)
   - Coding standards from the sub-SKILL
   - Current project governance context from the resolved instruction and memory surfaces
   - Summary of completed prerequisite tasks and their outputs

2. Launch all lane agents **in a single message** (this is how platforms achieve true parallelism). Each agent works in an isolated worktree to prevent file conflicts.
   - **In GitHub modes**: Each agent creates its own branch (`task/{issue_number}-{slug}`) and PR linked to its Issue
   - **In LOCAL_ONLY mode**: Use worktree isolation if available; otherwise work sequentially

3. When all agents return, consolidate their results:
   - Verify each agent reported DONE (not BLOCKED)
   - If any agent is BLOCKED, resolve the blocker and re-launch only that agent
   - **In GitHub modes**: Review and merge PRs sequentially, resolving any conflicts. Each merged PR auto-closes its linked Issue.
   - **In LOCAL_ONLY mode**: If agents worked in worktrees, merge their changes sequentially, resolving any conflicts
   - Run the project's full test suite to verify combined changes are coherent
   - Verify any reported instruction or memory surface updates are consistent and do not create competing sources of truth

---

## Progress Synchronization

After consolidating parallel results:

**In GitHub modes**:
- Verify all PRs are merged and linked Issues are closed
- Query GitHub Milestones for updated open/closed counts
- Update MASTER.md's "Issue Mapping" and "Milestones" tables with current states
- Update the platform's native task tool to reflect all completed tasks

**In LOCAL_ONLY mode**:
- Verify that each agent's progress file updates are consistent
- If agents wrote to the same progress file, reconcile the updates (agents may have stale counts)
- Update MASTER.md with the final accurate completion counts
- Update the platform's native task tool to reflect all completed tasks

**In all modes**:
- Reconcile memory surface updates from parallel agents before moving on
- Keep resolved instruction surfaces aligned if any lane changed project-level agent instructions

---

## Merge Risk Mitigation

The `task-breakdown.md` includes merge risk ratings for parallel lanes. Apply these safeguards:
- **Low risk**: Merge freely — lanes touch different files
- **Medium risk**: Merge sequentially, run tests between each merge
- **High risk**: Consider running these tasks sequentially instead of in parallel, or use worktree isolation with careful conflict resolution

---

## Post-Merge Architecture Validation

After the test suite passes on merged parallel results, perform these architecture-level checks. These go beyond functional correctness to verify structural integrity across lane boundaries.

### Cross-Lane S.U.P.E.R Compliance

Verify that parallel execution did not introduce cross-lane violations:
- **S (Single Purpose)**: No module gained responsibilities from multiple lanes
- **U (Unidirectional Flow)**: No circular dependencies introduced between code touched by different lanes
- **P (Ports)**: Interface contracts at lane boundaries remain intact — if Lane A changed a module's API, Lane B's usage still conforms
- **R (Replaceable)**: No lane created implicit coupling that makes another lane's modules harder to replace

### Aggregate Telemetry

After consolidating parallel results, aggregate the adaptive control telemetry:
1. Sum `task_drift` contributions from all tasks completed in this parallel batch
2. Update the cumulative `drift_score` in the Milestone description (GitHub modes) or MASTER.md (LOCAL_ONLY)
3. Evaluate thresholds against the new cumulative score
4. If any threshold is exceeded → trigger the appropriate response (see `references/adaptive-control.md` § 3) BEFORE starting the next phase
