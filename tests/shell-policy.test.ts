import { describe, expect, it } from 'vitest';
import {
  buildShellAllowlistUpgrade,
  createShellMcpPresetInput,
  DEFAULT_SHELL_MCP_ALLOWLIST_TOOL_NAMES,
  isShellMcpServer,
} from '../core/shell/policy';
import { DEFAULT_MCP_REQUEST_TIMEOUT_MS } from '../core/mcp/config';
import { SHELL_TOOL_NAMES } from '../core/shell/contracts';

describe('createShellMcpPresetInput', () => {
  it('defaults Shell MCP to auto execution while disabled by default', () => {
    const preset = createShellMcpPresetInput();

    expect(preset.enabled).toBe(false);
    expect(preset.allowlist).toEqual({ mode: 'allow', toolNames: [...DEFAULT_SHELL_MCP_ALLOWLIST_TOOL_NAMES] });
    expect(preset.execution).toEqual({ enabled: false, mode: 'auto' });
  });

  it('uses the default MCP request timeout unless explicitly overridden', () => {
    expect(createShellMcpPresetInput().timeouts?.requestMs)
      .toBe(DEFAULT_MCP_REQUEST_TIMEOUT_MS);
    expect(createShellMcpPresetInput({ requestMs: 300_000 }).timeouts?.requestMs)
      .toBe(300_000);
  });

  it('keeps shell_exec and the persistent session tools out of the default allowlist', () => {
    // These are the opt-in, risk-bearing tools. They must NOT appear in the
    // safe-by-default allowlist — the default preset exposes only read/status
    // tools so a fresh install cannot execute commands until the user opts in.
    const preset = createShellMcpPresetInput();
    const allowlisted = new Set(preset.allowlist?.toolNames ?? []);
    const gatedTools = [
    'shell_exec',
    'python_exec',
    'local_file_write',
    'local_file_edit',
    'local_file_read',
    'local_file_stat',
    'shell_session_begin',
    'shell_session_exec',
    'shell_session_end',
  ];
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
    expect(SHELL_TOOL_NAMES).toContain('local_file_edit');
  });

  it('upgrades legacy read-only Shell allowlists with local file tools too', () => {
    expect(buildShellAllowlistUpgrade({
      mode: 'allow',
      toolNames: ['shell_status', 'python_status'],
    })).toEqual({
      mode: 'allow',
      toolNames: [
      'shell_status',
      'python_status',
      'local_skill_preview',
      'local_folder_pick',
      'local_file_stat',
      'local_file_read',
      'local_file_write',
      'local_file_edit',
    ],
    });
  });

  it('preserves existing exec tools while upgrading Shell allowlists', () => {
    expect(buildShellAllowlistUpgrade({
      mode: 'allow',
      toolNames: ['shell_status', 'python_status', 'shell_exec'],
    })).toEqual({
      mode: 'allow',
      toolNames: [
      'shell_status',
      'python_status',
      'shell_exec',
      'local_skill_preview',
      'local_folder_pick',
      'local_file_stat',
      'local_file_read',
      'local_file_write',
      'local_file_edit',
    ],
    });
  });

  it('detects the built-in Shell Local server by name or native host', () => {
    expect(isShellMcpServer({
      displayName: 'Shell Local',
      transport: { kind: 'native_messaging', nativeHost: 'other.host' },
    })).toBe(true);
    expect(isShellMcpServer({
      displayName: 'Anything',
      transport: { kind: 'native_messaging', nativeHost: 'com.deepseek_pp.shell' },
    })).toBe(true);
    expect(isShellMcpServer({
      displayName: 'Anything',
      transport: { kind: 'native_messaging', nativeHost: 'com.example.other' },
    })).toBe(false);
  });
});
