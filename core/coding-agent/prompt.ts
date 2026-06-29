import type { ToolExecutionRecord } from '../types';
import { CODING_AGENT_MAX_STEPS, READONLY_TOOLS, WRITE_TOOLS, type CodingAgentState, type EditPlan, type ToolCategory } from './types';

/**
 * Build the coding-specific system prompt.
 * This is injected into DeepSeek requests when coding mode is active.
 */
export function buildCodingSystemPrompt(projectRoot?: string): string[] {
  return [
    'You are operating as a **coding agent**. Follow these principles:',
    '',
    '1. **Read before you write.** Always read a file before editing it. Know the current state.',
    '2. **Small, verifiable edits.** Prefer many small file_edit hunks over one large file_write. Each hunk should focus on one logical change.',
    '3. **Search before you assume.** Use code_search or file_search to find relevant code before making changes.',
    '4. **Check status first.** Run git_status at the start of a session to understand the working tree state.',
    '5. **Verify after editing.** After file_edit or file_write, check for syntax/compile errors. Use python_exec -c "compile(open(\'path\').read(), \'path\', \'exec\')" for Python, or shell_exec with the appropriate linter.',
    '6. **Iterate on failures.** If a verification step fails, diagnose and fix the issue. Do not move on with broken code.',
    '7. **Use git for safety.** After a meaningful set of changes, commit with git_commit. Use descriptive commit messages.',
    '8. **Plan before executing.** For multi-file changes, output an <edit_plan> block before making any edits.',
    '9. **Respect existing patterns.** Follow the coding style, naming conventions, and architecture patterns of the codebase.',
    '10. **Be aware of scope.** Do not modify files outside the task scope without explicitly noting it.',
    ...(projectRoot ? [`11. **Project root:** \`${projectRoot}\`. All file operations are relative to this directory unless otherwise specified.`] : []),
    '',
    'When a task is complete, signal with: <task_complete>{"summary": "what was done", "artifacts": ["file1.ts", "file2.ts"]}</task_complete>',
  ];
}

/**
 * Build the edit-plan prompt that runs at the start of a coding task.
 * The model should output a structured <edit_plan> block.
 */
export function buildEditPlanPrompt(task: string): string[] {
  return [
    '## Plan Before Editing',
    '',
    `Task: ${task}`,
    '',
    'Before making any edits, output an edit plan inside `<edit_plan>` tags:',
    '',
    '<edit_plan>',
    '{"summary": "Brief summary of changes",',
    ' "steps": [',
    '   {"action": "read", "file": "path/to/file.ts", "description": "Understand current implementation"},',
    '   {"action": "edit", "file": "path/to/file.ts", "description": "Add the new function"},',
    '   {"action": "verify", "file": "", "description": "Run compiler to check for errors"}',
    ' ],',
    ' "estimatedCalls": 5}',
    '</edit_plan>',
    '',
    'After the plan, proceed step by step. Each tool call should correspond to one step in the plan.',
  ];
}

/**
 * Build a coding-focused continuation prompt that includes session state.
 */
export function buildCodingContinuationPrompt(
  originalTask: string,
  executions: ToolExecutionRecord[],
  state: CodingAgentState,
): string[] {
  const hasFailures = executions.some((e) => !e.result.ok);
  const recentEdits = state.fileEdits.filter(e => e.status === 'applied').slice(-5);

  const parts: string[] = [
    '<original_task>',
    originalTask,
    '</original_task>',
    '',
    '<session_state>',
    `Total tool calls so far: ${executions.length}`,
    `Iteration: ${state.iterationCount}`,
    state.projectRoot ? `Project root: ${state.projectRoot}` : '',
    '',
    recentEdits.length > 0 ? 'Recent file edits:' : '',
    ...recentEdits.map(e => `  - ${e.path} (${e.hunks} hunk(s))`),
    '',
    hasFailures ? 'Note: Some previous steps failed. Diagnose and retry.' : '',
    '</session_state>',
    '',
    '<tool_results>',
    JSON.stringify(
      executions.map((e) => ({
        tool: e.name,
        provider: e.provider?.displayName,
        ok: e.result.ok,
        summary: e.result.summary,
        error: e.result.error,
        truncated: e.result.truncated === true,
      })),
      null,
      2,
    ),
    '</tool_results>',
  ];

  return parts;
}

/**
 * Build a verification prompt after edits are applied.
 */
export function buildVerifyPrompt(
  changedFiles: string[],
  previousErrors: string[],
): string[] {
  return [
    '## Verification Required',
    '',
    'The following files were just changed:',
    ...changedFiles.map(f => `  - ${f}`),
    '',
    ...(previousErrors.length > 0 ? [
      'Previous verification issues (check if these are resolved):',
      ...previousErrors.map(e => `  - ${e}`),
      '',
    ] : []),
    'Please verify the changes by:',
    '1. Running the compiler/type checker if applicable',
    '2. Running the linter',
    '3. Checking for syntax errors',
    '4. If everything passes, signal completion. If not, fix the issues.',
  ];
}

/**
 * Categorize a tool by its risk for coding dispatch.
 */
export function categorizeTool(toolName: string): ToolCategory {
  if (READONLY_TOOLS.has(toolName)) return 'readonly';
  if (WRITE_TOOLS.has(toolName)) return 'write';
  return 'admin';
}

/**
 * Determine if we're in the verification phase based on execution count and state.
 */
export function shouldEnterVerification(
  state: CodingAgentState,
  maxSteps: number = CODING_AGENT_MAX_STEPS,
): boolean {
  if (state.planningPhase) return false;
  return state.iterationCount >= maxSteps - 3; // Last 3 steps for verification
}

/**
 * Parse an <edit_plan> block from model output, if present.
 */
export function extractEditPlan(text: string): EditPlan | null {
  const match = /<edit_plan>\s*(\{[\s\S]*?\})\s*<\/edit_plan>/i.exec(text);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      steps: Array.isArray(parsed.steps) ? parsed.steps : [],
      estimatedCalls: typeof parsed.estimatedCalls === 'number' ? parsed.estimatedCalls : 5,
    };
  } catch {
    return null;
  }
}
