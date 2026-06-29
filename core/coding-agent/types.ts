import type { ToolExecutionRecord } from '../types';

/** Coding agent state tracked across loop iterations */
export interface CodingAgentState {
  projectRoot: string | null;
  currentTask: string;
  fileEdits: CodingFileEdit[];
  compileCheckResults: string[];
  testResults: string[];
  iterationCount: number;
  planningPhase: boolean;
  verificationPhase: boolean;
}

export interface CodingFileEdit {
  path: string;
  hunks: number;
  status: 'pending' | 'applied' | 'failed';
  error?: string;
  appliedAt?: number;
}

export interface EditPlan {
  summary: string;
  steps: EditPlanStep[];
  estimatedCalls: number;
}

export interface EditPlanStep {
  action: string;
  file: string;
  description: string;
}

/** Result of a verification step (compile, lint, test) */
export interface VerificationResult {
  ok: boolean;
  type: 'compile' | 'lint' | 'test' | 'typecheck';
  output: string;
  errorCount: number;
}

/** Tool category for coding-specific dispatch */
export type ToolCategory = 'readonly' | 'write' | 'admin';

/** Coding agent loop configuration */
export const CODING_AGENT_MAX_STEPS = 30;
export const CODING_AGENT_MAX_VERIFY_STEPS = 3;
export const CODING_AGENT_PLANNING_STEPS = 2;
export const CODING_AGENT_STEP_TIMEOUT_MS = 120_000;

/** Tool names considered readonly (can parallelize) */
export const READONLY_TOOLS = new Set([
  'file_read',
  'file_list',
  'file_search',
  'code_search',
  'code_symbol',
  'code_structure',
  'code_glob',
  'code_batch_read',
  'git_status',
  'git_diff',
  'git_log',
  'git_branch',
  'shell_status',
  'python_status',
  'local_skill_preview',
  'web_search',
  'web_fetch',
  'browser_snapshot',
  'browser_list_tabs',
]);

/** Tool names considered write operations */
export const WRITE_TOOLS = new Set([
  'file_write',
  'file_edit',
  'file_move_copy',
  'git_commit',
  'git_push',
  'shell_exec',
  'python_exec',
  'shell_session_begin',
  'shell_session_exec',
  'shell_session_end',
  'sandbox_run',
  'browser_navigate',
  'browser_click',
  'browser_fill',
  'browser_key',
  'browser_type',
  'browser_attach_file',
  'browser_evaluate_script',
  'browser_close_tab',
  'browser_handle_dialog',
]);
