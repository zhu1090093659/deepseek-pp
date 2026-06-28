import { afterEach, describe, expect, it } from 'vitest';
import { createAgentStepElement, injectInlineAgentStyles, updateStepStreamText } from '../core/inline-agent/renderer';

describe('inline agent renderer', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('renders streaming markdown while preserving the raw step text', () => {
    const step = createAgentStepElement(0);

    updateStepStreamText(step, [
      '### Market summary',
      '',
      '| Metric | Value |',
      '| --- | --- |',
      '| **Average price** | 47k |',
    ].join('\n'));

    const body = step.querySelector<HTMLElement>('.dpp-agent-step-body');

    expect(body?.getAttribute('data-dpp-raw-text')).toContain('| Metric | Value |');
    expect(body?.innerHTML).toContain('<h3>Market summary</h3>');
    expect(body?.innerHTML).toContain('<table>');
    expect(body?.innerHTML).toContain('<td><strong>Average price</strong></td>');
  });

  it('keeps the streaming step body scrolled to the newest output', () => {
    const step = createAgentStepElement(0);
    const body = step.querySelector<HTMLElement>('.dpp-agent-step-body');
    expect(body).toBeTruthy();
    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 480 });

    updateStepStreamText(step, 'line 1\nline 2\nline 3');

    expect(body?.scrollTop).toBe(480);
  });

  it('uses the shared injected theme for dark-mode readable text', () => {
    injectInlineAgentStyles();

    const agentStyle = document.getElementById('dpp-inline-agent-css');
    expect(document.getElementById('dpp-injected-theme-css')).not.toBeNull();
    expect(agentStyle?.textContent).toContain('color: var(--dpp-ui-text);');
    expect(agentStyle?.textContent).toContain('[data-dpp-body-text]');
    expect(agentStyle?.textContent).toContain('color: var(--dpp-ui-accent);');
    expect(agentStyle?.textContent).not.toContain('var(--ds-text');
  });
});
