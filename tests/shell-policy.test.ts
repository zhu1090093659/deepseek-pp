import { describe, expect, it } from 'vitest';
import { createShellMcpPresetInput } from '../core/shell/policy';
import { SHELL_TOOL_NAMES } from '../core/shell/contracts';

describe('createShellMcpPresetInput', () => {
  it('defaults Shell MCP to explicit manual opt-in', () => {
    const preset = createShellMcpPresetInput();

    expect(preset.enabled).toBe(false);
    expect(preset.allowlist).toEqual({ mode: 'allow', toolNames: ['shell_status', 'python_status', 'local_skill_preview', 'local_folder_pick', 'file_read', 'file_list', 'file_search', 'git_status', 'git_diff', 'git_log', 'git_branch'] });
    expect(preset.execution).toEqual({ enabled: false, mode: 'manual' });
  });

  it('keeps shell_exec and the persistent session tools out of the default allowlist', () => {
    // These are the opt-in, risk-bearing tools. They must NOT appear in the
    // safe-by-default allowlist — the default preset exposes only read/status
    // tools so a fresh install cannot execute commands until the user opts in.
    const preset = createShellMcpPresetInput();
    const allowlisted = new Set(preset.allowlist?.toolNames ?? []);
    const gatedTools = ['shell_exec', 'python_exec', 'shell_session_begin', 'shell_session_exec', 'shell_session_end'];
    for (const tool of gatedTools) {
      expect(allowlisted.has(tool as string)).toBe(false);
    }
  });

  it('registers the persistent session tools in the shell tool catalog', () => {
    // Sanity: contracts and the native host must agree on tool names. This guards
    // against silent drift when the allowlist or tool list changes.
    expect(SHELL_TOOL_NAMES).toContain('shell_session_begin');
    expect(SHELL_TOOL_NAMES).toContain('shell_session_exec');
    expect(SHELL_TOOL_NAMES).toContain('shell_session_end');
  });
});
