import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('sidepanel lazy route boundaries', () => {
  it('keeps top-level non-chat pages out of the static sidepanel entry graph', () => {
    const source = readFileSync('entrypoints/sidepanel/App.tsx', 'utf8');

    for (const page of [
      'LibraryPage',
      'ProjectsPage',
      'SettingsPage',
      'CapabilitiesPage',
      'ChatPage',
    ]) {
      expect(source).toContain(`lazy(() => import('./pages/${page}'))`);
      expect(source).not.toMatch(new RegExp(`import\\s+${page}\\s+from`));
    }
    expect(source).toContain('fallback={<RouteFallback />}');
    expect(source).not.toContain("from './components/settings/primitives'");
  });

  it('loads each capability page from its own navigation boundary', () => {
    const source = readFileSync('entrypoints/sidepanel/pages/CapabilitiesPage.tsx', 'utf8');

    for (const page of [
      'SkillPage',
      'McpPage',
      'ToolsPage',
      'BrowserControlPage',
      'PresetPage',
      'AutomationPage',
    ]) {
      expect(source).toContain(`lazy(() => import('./${page}'))`);
      expect(source).not.toMatch(new RegExp(`import\\s+${page}\\s+from`));
    }
    expect(source).toContain('<Suspense fallback={<RouteFallback />}>');
  });

  it('loads each settings section independently after the settings route opens', () => {
    const source = readFileSync('entrypoints/sidepanel/pages/SettingsPage.tsx', 'utf8');

    for (const page of [
      'GeneralSubPage',
      'ApiSubPage',
      'PromptSubPage',
      'VoiceSubPage',
      'AppearanceSubPage',
      'UsageSubPage',
      'DataSubPage',
      'AboutSubPage',
    ]) {
      expect(source).toContain(`lazy(() => import('../components/settings/${page}'))`);
      expect(source).not.toMatch(new RegExp(`import\\s+${page}\\s+from`));
    }
    expect(source).toContain('<Suspense fallback={<RouteFallback />}>');
  });

  it('retains independent Memory and Saved chunks inside Library', () => {
    const source = readFileSync('entrypoints/sidepanel/pages/LibraryPage.tsx', 'utf8');

    expect(source).toContain("lazy(() => import('./MemoryPage'))");
    expect(source).toContain("lazy(() => import('./SavedPage'))");
    expect(source).toContain('<Suspense fallback={<RouteFallback />}>');
  });
});
