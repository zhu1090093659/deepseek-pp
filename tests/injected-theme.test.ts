import { afterEach, describe, expect, it } from 'vitest';
import { injectInjectedThemeStyles } from '../core/ui/injected-theme';

describe('injected UI theme styles', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('references DeepSeek native CSS variables with fallback values', () => {
    injectInjectedThemeStyles();

    const css = document.getElementById('dpp-injected-theme-css')?.textContent ?? '';
    // Uses DeepSeek dsw-alias CSS variables instead of hardcoded OKLCH
    expect(css).toContain('var(--dsw-alias-bg-layer-1');
    expect(css).toContain('var(--dsw-alias-label-primary');
    expect(css).toContain('var(--dsw-alias-brand-primary');
    expect(css).toContain('var(--dsw-alias-markdown-code-block');
    expect(css).toContain('var(--dsw-alias-border-l2');
    // Falls back to OKLCH values when DS variables are absent
    expect(css).toContain('oklch(0.62 0.19 264)');
  });

  it('injects the shared theme stylesheet once', () => {
    injectInjectedThemeStyles();
    injectInjectedThemeStyles();

    expect(document.querySelectorAll('#dpp-injected-theme-css')).toHaveLength(1);
  });
});
