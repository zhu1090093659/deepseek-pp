const STYLE_ID = 'dpp-injected-theme-css';

export function injectInjectedThemeStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  // Reference DeepSeek's native CSS variables so injected components
  // automatically follow the page theme without a separate palette.
  // Falls back to reasonable OKLCH values when DS variables are absent.
  style.textContent = `
body {
  --dpp-ui-surface:      var(--dsw-alias-bg-layer-1, oklch(0.998 0.002 264));
  --dpp-ui-surface-muted: var(--dsw-alias-bg-overlay, oklch(0.965 0.005 264));
  --dpp-ui-surface-hover: var(--dsw-alias-interactive-bg-hover, oklch(0.95 0.006 264));
  --dpp-ui-text:         var(--dsw-alias-label-primary, oklch(0.24 0.018 264));
  --dpp-ui-text-muted:   var(--dsw-alias-label-secondary, oklch(0.52 0.020 264));
  --dpp-ui-text-subtle:  var(--dsw-alias-label-tertiary, oklch(0.70 0.015 264));
  --dpp-ui-border:       var(--dsw-alias-border-l2, oklch(0.90 0.008 264));
  --dpp-ui-border-muted: var(--dsw-alias-border-l1, oklch(0.94 0.006 264));
  --dpp-ui-accent:       var(--dsw-alias-brand-primary, oklch(0.62 0.19 264));
  --dpp-ui-accent-strong: var(--dsw-alias-brand-text, oklch(0.56 0.20 266));
  --dpp-ui-accent-soft:  var(--dsw-alias-interactive-bg-hover-accent, oklch(0.96 0.025 264));
  --dpp-ui-accent-panel: var(--dsw-alias-button-primary-dimmed, oklch(0.62 0.19 264 / 0.06));
  --dpp-ui-code-bg:      var(--dsw-alias-markdown-code-block, oklch(0.30 0.02 264 / 0.06));
  --dpp-ui-danger:       var(--dsw-alias-state-error-primary, oklch(0.64 0.22 25));
  --dpp-ui-danger-panel: var(--dsw-alias-state-error-secondary, oklch(0.64 0.22 25 / 0.08));
  --dpp-ui-success:      var(--dsw-alias-state-success-primary, oklch(0.70 0.15 162));
  --dpp-ui-warning:      var(--dsw-alias-state-warn-primary, oklch(0.75 0.15 75));
  --dpp-ui-error:        var(--dsw-alias-state-error-primary, oklch(0.64 0.22 25));
  --dpp-ui-shadow:       0 0 0 1px var(--dpp-ui-border), inset 0 1px 0 oklch(1 0 0 / 0.05);
  --dpp-ui-panel-shadow: var(--dsw-alias-bg-mask-2, oklch(0.25 0.04 264 / 0.14)) -14px 0 40px;
}
`;
  document.head.appendChild(style);
}
