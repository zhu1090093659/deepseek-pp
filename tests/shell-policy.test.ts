import { describe, expect, it } from 'vitest';
import { createShellMcpPresetInput } from '../core/shell/policy';

describe('createShellMcpPresetInput', () => {
  it('defaults Shell MCP to explicit manual opt-in', () => {
    const preset = createShellMcpPresetInput();

    expect(preset.enabled).toBe(false);
    expect(preset.allowlist).toEqual({ mode: 'allow', toolNames: ['shell_status', 'python_status'] });
    expect(preset.execution).toEqual({ enabled: false, mode: 'manual' });
  });
});

