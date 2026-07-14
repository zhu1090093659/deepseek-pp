import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

  it('does not retain or replace the unused broad platform facade', () => {
    const platformSource = readdirSync('core/platform')
      .filter((file) => file.endsWith('.ts'))
      .map((file) => readFileSync(`core/platform/${file}`, 'utf8'))
      .join('\n');
    const rootTypes = readFileSync('core/types.ts', 'utf8');
    const background = readFileSync('entrypoints/background.ts', 'utf8');
    const browserControl = readFileSync('core/browser-control/tool.ts', 'utf8');

    expect(existsSync('core/platform/browser.ts')).toBe(false);
    expect(`${platformSource}\n${rootTypes}`).not.toMatch(
      /\bPlatform(?:Services|Storage|Runtime|Download|FilePicker|PickedFile)\b/,
    );
    expect(background).toContain('getCurrentPlatformEnvironment');
    expect(browserControl).toContain('getCurrentPlatformEnvironment');
    expect(`${background}\n${browserControl}`).not.toContain(
      'getCurrentBrowserExtensionEnvironment',
    );
  });
});
