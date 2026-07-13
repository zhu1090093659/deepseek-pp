import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('DeepSeek active protocol import boundary', () => {
  it('keeps pure codecs independent from runtime and passive interceptor modules', () => {
    for (const path of [
      'core/deepseek/request-codec.ts',
      'core/deepseek/stream-codec.ts',
    ]) {
      const source = readFileSync(path, 'utf8');
      expect(source, path).not.toMatch(/from ['"].*interceptor/);
      expect(source, path).not.toMatch(/from ['"].*automation/);
      expect(source, path).not.toMatch(/from ['"].*entrypoints/);
      expect(source, path).not.toMatch(/\b(?:chrome|document|localStorage)\b/);
      expect(source, path).not.toMatch(/\bfetch\s*\(/);
    }
  });

  it('makes automation consume the active-client port instead of the compatibility facade', () => {
    const runner = readFileSync('core/automation/runner.ts', 'utf8');
    expect(runner).toContain("from '../deepseek/automation-client-port'");
    expect(runner).not.toContain("from '../deepseek/active-client'");
    expect(runner).not.toContain("from '../deepseek/adapter'");
    expect(runner).toContain('deepSeekClient: DeepSeekAutomationClient');
    expect(runner).not.toContain('DEFAULT_DEEPSEEK_AUTOMATION_CLIENT');

    const adapter = readFileSync('core/deepseek/adapter.ts', 'utf8');
    expect(adapter).toContain("export * from './active-client'");
    expect(adapter).not.toContain('fetch(');
  });

  it('makes active and passive consumers import the shared SSE authority directly', () => {
    const activeClient = readFileSync('core/deepseek/active-client.ts', 'utf8');
    const officialApi = readFileSync('core/deepseek/official-api.ts', 'utf8');
    const passiveInterceptor = readFileSync('core/interceptor/fetch-hook.ts', 'utf8');
    expect(activeClient).not.toMatch(/from ['"].*interceptor/);
    expect(officialApi).not.toMatch(/from ['"].*interceptor/);
    expect(passiveInterceptor).toContain("from '../deepseek/stream-codec'");
    expect(passiveInterceptor).toContain("from '../deepseek/stream-metrics'");
    expect(existsSync('core/interceptor/sse-parser.ts')).toBe(false);
    expect(existsSync('core/interceptor/token-speed.ts')).toBe(false);
  });

  it('does not retain the retired automation window bridge path', () => {
    const messages = readFileSync('core/automation/messages.ts', 'utf8');
    const types = readFileSync('core/automation/types.ts', 'utf8');
    expect(messages).not.toContain('AUTOMATION_BRIDGE_TIMEOUT_MS');
    expect(messages).not.toContain('DPP_AUTOMATION_WINDOW');
    expect(types).not.toContain('AutomationBridge');
  });
});
