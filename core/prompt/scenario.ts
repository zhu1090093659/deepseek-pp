import type { AgentScenario, ToolGroup, ToolGroupId } from './types';

/**
 * Tool group definitions with scenario mappings.
 * Each group defines which scenarios it belongs to and any
 * host requirements (e.g., shell MCP or code-index must be connected).
 */
export const TOOL_GROUPS: ToolGroup[] = [
  { id: 'memory', title: 'Memory', scenarios: ['chat', 'coding', 'automation', 'browsing'] },
  { id: 'web', title: 'Web Search', scenarios: ['chat', 'coding', 'automation', 'browsing'] },
  { id: 'artifact', title: 'Artifact', scenarios: ['chat', 'coding', 'automation', 'browsing'] },
  { id: 'sandbox', title: 'Sandbox', scenarios: ['chat', 'coding', 'automation'] },
  { id: 'shell', title: 'Shell', scenarios: ['coding', 'automation'], requiresHost: ['com.deepseek_pp.shell'] },
  { id: 'file', title: 'File System', scenarios: ['coding'], requiresHost: ['com.deepseek_pp.shell'] },
  { id: 'code', title: 'Code Understanding', scenarios: ['coding'], requiresHost: ['com.deepseek_pp.code_index'] },
  { id: 'git', title: 'Git', scenarios: ['coding'], requiresHost: ['com.deepseek_pp.shell'] },
  { id: 'browser', title: 'Browser Control', scenarios: ['browsing', 'automation'] },
  { id: 'mcp', title: 'External MCP', scenarios: ['chat', 'coding', 'automation', 'browsing'] },
];

/**
 * Get the tool groups enabled for a given scenario.
 */
export function getGroupsForScenario(scenario: AgentScenario): ToolGroup[] {
  return TOOL_GROUPS.filter(g => g.scenarios.includes(scenario));
}

/**
 * Get group IDs enabled for a scenario.
 */
export function getGroupIdsForScenario(scenario: AgentScenario): ToolGroupId[] {
  return getGroupsForScenario(scenario).map(g => g.id);
}

/**
 * Map a tool name to its group ID.
 */
export function getToolGroup(toolName: string): ToolGroupId {
  if (toolName.startsWith('memory_')) return 'memory';
  if (toolName.startsWith('web_')) return 'web';
  if (toolName.startsWith('shell_') || toolName.startsWith('python_') || toolName.startsWith('local_')) return 'shell';
  if (toolName.startsWith('file_')) return 'file';
  if (toolName.startsWith('code_')) return 'code';
  if (toolName.startsWith('git_')) return 'git';
  if (toolName.startsWith('artifact_') || toolName.startsWith('skill_')) return 'artifact';
  if (toolName.startsWith('sandbox_')) return 'sandbox';
  if (toolName.startsWith('browser_')) return 'browser';
  return 'mcp';
}

/**
 * Scenario descriptions — injected into the dynamic prompt suffix
 * to guide model tool selection.
 */
export const SCENARIO_GUIDANCE: Record<AgentScenario, string> = {
  chat: `You are in chat mode. Available tools: memory (save/update/delete long-term memories), web (search the internet), artifact (create code previews), and sandbox (run short code snippets).
Do NOT use file system, git, or browser control tools unless the user explicitly asks about them.`,
  coding: `You are in coding mode. Available tools:

📁 FILE OPERATIONS — Use FIRST before editing:
  file_read — read files with line offset support
  file_write — write files (auto-backup on overwrite)
  file_edit — search-replace editing (preferred over file_write for small changes)
  file_list — browse directory structure
  file_search — full-text search across files

🔍 CODE UNDERSTANDING — Use BEFORE modifying:
  code_search — regex search (uses ripgrep when available)
  code_symbol — find function/class definitions
  code_structure — get file outline (imports, exports, classes)
  code_glob — find files by pattern

📊 GIT — Use to track state:
  git_status — check working tree before changes
  git_diff — review changes before commit
  git_log — recent commit history
  git_commit — stage and commit
  git_branch — manage branches
  git_push — push to remote (requires confirmation)

🐚 SHELL — For build, test, and command execution:
  shell_exec — run commands
  python_exec — short computation snippets

Workflow: plan → read → edit → verify → commit. Always read before editing.`,
  automation: `You are running an automated task. Available tools: web (search), shell (execute commands), and browser (control pages).
Complete the task autonomously and signal completion with <task_complete>.`,
  browsing: `You are in browser control mode. Available tools: browser_snapshot (observe page state), browser_click/browser_fill/browser_type (interact), browser_navigate (change URL), and browser_list_tabs (manage tabs). Use web_search for information retrieval.
Capture a snapshot first, then decide what actions to take.`,
};

/**
 * Scenario-specific tool selection priority rules.
 * These help the model choose the right tool for the job.
 */
export const TOOL_PRIORITY_RULES: Record<AgentScenario, string[]> = {
  chat: [
    'web_search > memory_save > memory',
    'Use memory_save for user preferences, identity, important facts',
    'Use web_search for real-time info, news, fact-checking',
  ],
  coding: [
    'git_status | git_diff > file_read > file_edit > file_write',
    'code_search > file_search for regex (faster)',
    'file_read with offset/limit for large files',
    'file_edit with multiple hunks for targeted changes',
    'python_exec to verify syntax: compile() or run',
    'git_commit after meaningful change sets',
  ],
  automation: [
    'shell_exec for local commands',
    'browser_navigate > browser_snapshot for page state',
    'web_search for data retrieval',
  ],
  browsing: [
    'browser_snapshot > browser_select_tab > browser_navigate',
    'Snapshot first, then interact',
    'browser_evaluate_script for JS execution',
  ],
};
