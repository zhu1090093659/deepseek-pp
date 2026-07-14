import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  decodeThemeUpdatedEvent,
  isSidepanelRuntimeEvent,
} from '../entrypoints/sidepanel/runtime-event-codec';

const SIDEPANEL_ROOT = 'entrypoints/sidepanel';

describe('Side Panel runtime transport contract', () => {
  it('keeps chrome.runtime.sendMessage behind the typed runtime client', () => {
    const directTransportFiles = sourceFiles(SIDEPANEL_ROOT)
      .filter((file) => readFileSync(file, 'utf8').includes('chrome.runtime.sendMessage'))
      .map((file) => relative('.', file));

    expect(directTransportFiles).toEqual(['entrypoints/sidepanel/runtime-client.ts']);
  });

  it('reuses the authoritative runtime failure and error projection contract', () => {
    const source = readFileSync('entrypoints/sidepanel/runtime-client.ts', 'utf8');

    expect(source).toContain("from '../../core/messaging/runtime-response'");
    expect(source).not.toContain('function isRuntimeFailure(');
    expect(source).not.toContain('function getErrorMessage(');
  });

  it('generation-fences every remaining page-owned runtime invalidation subscription', () => {
    for (const file of [
      'entrypoints/sidepanel/pages/AutomationPage.tsx',
      'entrypoints/sidepanel/pages/BrowserControlPage.tsx',
      'entrypoints/sidepanel/pages/ProjectsPage.tsx',
    ]) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).toContain('isSidepanelRuntimeEvent(');
      expect(source, file).toContain('createRequestGenerationFence(');
      expect(source, file).toContain('.invalidate()');
    }

    const bootstrap = readFileSync('entrypoints/sidepanel/main.tsx', 'utf8');
    expect(bootstrap).toContain('decodeThemeUpdatedEvent(message)');
    expect(bootstrap).toContain('createRequestGenerationFence()');
    expect(bootstrap).toContain('requestFence.begin()');
  });

  it('accepts only plain, explicitly named invalidation and theme events', () => {
    expect(isSidepanelRuntimeEvent(
      { type: 'AUTOMATIONS_UPDATED' },
      ['AUTOMATIONS_UPDATED'] as const,
    )).toBe(true);
    expect(isSidepanelRuntimeEvent(
      Object.assign(Object.create({}), { type: 'AUTOMATIONS_UPDATED' }),
      ['AUTOMATIONS_UPDATED'] as const,
    )).toBe(false);
    expect(isSidepanelRuntimeEvent(
      { type: 1 },
      ['AUTOMATIONS_UPDATED'] as const,
    )).toBe(false);

    expect(decodeThemeUpdatedEvent({ type: 'THEME_UPDATED', theme: 'dark' })).toBe('dark');
    expect(decodeThemeUpdatedEvent({ type: 'THEME_UPDATED', theme: 'system' })).toBeNull();
    expect(decodeThemeUpdatedEvent({ type: 'OTHER', theme: 'dark' })).toBeNull();
  });
});

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.tsx?$/.test(entry.name) ? [path] : [];
    })
    .sort();
}
