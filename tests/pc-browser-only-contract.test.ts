import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('PC browser-only product contract', () => {
  it('ships only Chrome, Edge, and Firefox build targets', () => {
    const config = readFileSync('wxt.config.ts', 'utf8');

    expect(config).toContain("targetBrowsers: ['chrome', 'edge', 'firefox']");
  });

  it('does not expose an Android project, build script, CI job, or platform kind', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    const platformCapabilities = readFileSync('core/platform/capabilities.ts', 'utf8');

    expect(existsSync('android')).toBe(false);
    expect(Object.keys(packageJson.scripts).filter((name) => name.includes('android'))).toEqual([]);
    expect(workflow).not.toMatch(/android/i);
    expect(platformCapabilities).not.toContain('android_webview');
  });
});
