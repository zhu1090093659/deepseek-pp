import { renderInlineMarkdown } from './markdown';
import { injectInjectedThemeStyles } from '../ui/injected-theme';

const AGENT_STEP_STYLE_ID = 'dpp-inline-agent-css';

export interface InlineAgentRendererLabels {
  step: (stepNumber: number) => string;
  streaming: string;
  stop: string;
  footerComplete: (totalSteps: number, totalTools: number) => string;
  footerError: (totalSteps: number, totalTools: number) => string;
}

export function injectInlineAgentStyles(): void {
  injectInjectedThemeStyles();
  if (document.getElementById(AGENT_STEP_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = AGENT_STEP_STYLE_ID;
  style.textContent = `
    .dpp-agent-container {
      margin-top: 12px;
      padding-left: 12px;
      border-left: 1px solid var(--dpp-ui-border);
    }
    .dpp-agent-container[data-restored="true"] {
      margin-bottom: 12px;
    }
    .dpp-agent-step {
      margin-bottom: 8px;
      border: 1px solid var(--dpp-ui-border);
      border-radius: 6px;
      overflow: hidden;
      background: var(--dpp-ui-surface);
      color: var(--dpp-ui-text);
    }
    .dpp-agent-step[data-status="streaming"] {
      border-color: var(--dpp-ui-accent);
    }
    .dpp-agent-step[data-status="executing_tools"] {
      border-color: var(--dpp-ui-warning);
    }
    .dpp-agent-step[data-status="error"] {
      border-color: var(--dpp-ui-error);
    }
    .dpp-agent-step-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      font-size: 12px;
      color: var(--dpp-ui-text-muted);
      background: var(--dpp-ui-surface-muted);
      cursor: pointer;
      user-select: none;
    }
    .dpp-agent-step-header::after {
      content: '\\25BC';
      font-size: 9px;
      margin-left: auto;
      transition: transform 0.2s ease;
    }
    .dpp-agent-step[data-collapsed="true"] .dpp-agent-step-header::after {
      transform: rotate(-90deg);
    }
    .dpp-agent-step-indicator {
      font-weight: 600;
      color: var(--dpp-ui-accent);
    }
    .dpp-agent-step-status {
      flex: 1;
    }
    .dpp-agent-stop-btn {
      padding: 2px 8px;
      font-size: 11px;
      border: 1px solid var(--dpp-ui-error);
      border-radius: 4px;
      background: transparent;
      color: var(--dpp-ui-error);
      cursor: pointer;
    }
    .dpp-agent-stop-btn:hover {
      background: var(--dpp-ui-danger-panel);
    }
    .dpp-agent-step-body {
      padding: 8px 10px;
      font-size: 13px;
      line-height: 1.5;
      color: var(--dpp-ui-text);
      word-break: break-word;
      max-height: 300px;
      overflow-y: auto;
      transition: max-height 0.3s ease, padding 0.3s ease, opacity 0.2s ease;
    }
    .dpp-agent-step-body:empty {
      display: none;
    }
    .dpp-agent-step-body * { color: inherit; }
    .dpp-agent-step-body h2,
    .dpp-agent-step-body h3,
    .dpp-agent-step-body h4 {
      margin: 8px 0 5px;
      font-weight: 600;
      line-height: 1.35;
    }
    .dpp-agent-step-body h2 { font-size: 1.1em; }
    .dpp-agent-step-body h3,
    .dpp-agent-step-body h4 { font-size: 1.02em; }
    .dpp-agent-step-body p { margin: 4px 0; }
    .dpp-agent-step-body ul,
    .dpp-agent-step-body ol {
      margin: 4px 0 4px 18px;
    }
    .dpp-agent-step-body li {
      margin: 2px 0;
    }
    .dpp-agent-step-body strong {
      font-weight: 600;
    }
    .dpp-agent-step-body em {
      font-style: italic;
    }
    .dpp-agent-step-body code {
      padding: 1px 4px;
      border-radius: 4px;
      background: var(--dpp-ui-code-bg);
      font-family: 'SF Mono', Monaco, Menlo, Consolas, monospace;
      font-size: 0.92em;
    }
    .dpp-agent-step-body pre {
      margin: 6px 0;
      padding: 8px;
      border-radius: 6px;
      background: var(--dpp-ui-code-bg);
      overflow-x: auto;
    }
    .dpp-agent-step-body pre code {
      padding: 0;
      background: transparent;
      white-space: pre;
    }
    .dpp-agent-step-body table {
      width: 100%;
      margin: 8px 0;
      border-collapse: collapse;
      font-size: 12px;
    }
    .dpp-agent-step-body th,
    .dpp-agent-step-body td {
      padding: 5px 6px;
      border-bottom: 1px solid var(--dpp-ui-border);
      text-align: left;
      vertical-align: top;
    }
    .dpp-agent-step-body th {
      font-weight: 600;
      color: var(--dpp-ui-text-muted);
    }
    .dpp-agent-step[data-collapsed="true"] .dpp-agent-step-body {
      max-height: 0;
      padding: 0 10px;
      opacity: 0;
      overflow: hidden;
    }
    .dpp-agent-step[data-collapsed="true"] .dpp-agent-step-tools {
      max-height: 0;
      padding: 0 10px;
      opacity: 0;
      overflow: hidden;
    }
    .dpp-agent-step-tools {
      padding: 4px 10px 8px;
      font-size: 12px;
      color: var(--dpp-ui-text-muted);
      transition: max-height 0.3s ease, padding 0.3s ease, opacity 0.2s ease;
    }
    .dpp-agent-step-tool-item {
      padding: 2px 0;
    }
    .dpp-agent-step-tool-item.ok::before {
      content: '\\2713 ';
      color: var(--dpp-ui-success);
    }
    .dpp-agent-step-tool-item.err::before {
      content: '\\2717 ';
      color: var(--dpp-ui-error);
    }
    .dpp-agent-footer {
      margin-top: 8px;
      padding: 6px 0;
      font-size: 12px;
      color: var(--dpp-ui-text-muted);
    }
    .dpp-agent-footer.complete::before {
      content: '\\25A0 ';
      color: var(--dpp-ui-success);
    }
    .dpp-agent-footer.error::before {
      content: '\\25A0 ';
      color: var(--dpp-ui-error);
    }

    body.dpp-theme-dark .dpp-agent-stop-btn:hover {
      background: var(--dpp-ui-danger-panel);
    }
    [data-dpp-body-text] {
      font-size: inherit;
      line-height: 1.7;
      margin-top: 12px;
      color: var(--dpp-ui-text);
      word-break: break-word;
    }
    [data-dpp-body-text] * { color: inherit; }
    [data-dpp-body-text] h3 { font-size: 1.1em; font-weight: 600; margin: 10px 0 4px; }
    [data-dpp-body-text] p { margin: 3px 0; }
    [data-dpp-body-text] ul, [data-dpp-body-text] ol { margin: 3px 0 3px 16px; }
    [data-dpp-body-text] strong { font-weight: 600; }
    [data-dpp-body-text] a { color: var(--dpp-ui-accent); text-decoration: underline; }
    [data-dpp-body-text] table {
      width: 100%;
      margin: 10px 0;
      border-collapse: collapse;
      font-size: 0.95em;
    }
    [data-dpp-body-text] th,
    [data-dpp-body-text] td {
      padding: 7px 8px;
      border-bottom: 1px solid var(--dpp-ui-border);
      text-align: left;
      vertical-align: top;
    }
    [data-dpp-body-text] th { font-weight: 600; }
  `;
  document.head.appendChild(style);
}

export function removeInlineAgentStyles(): void {
  document.getElementById(AGENT_STEP_STYLE_ID)?.remove();
}

export function createAgentContainer(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'dpp-agent-container';
  container.setAttribute('data-dpp-agent', 'true');
  return container;
}

export function createAgentStepElement(
  stepIndex: number,
  onStop?: () => void,
  labels?: Partial<InlineAgentRendererLabels>,
): HTMLElement {
  const step = document.createElement('div');
  step.className = 'dpp-agent-step';
  step.setAttribute('data-step-index', String(stepIndex));
  step.setAttribute('data-status', 'streaming');

  const header = document.createElement('div');
  header.className = 'dpp-agent-step-header';
  header.addEventListener('click', () => {
    const collapsed = step.getAttribute('data-collapsed') === 'true';
    step.setAttribute('data-collapsed', collapsed ? 'false' : 'true');
  });

  const indicator = document.createElement('span');
  indicator.className = 'dpp-agent-step-indicator';
  indicator.textContent = labels?.step?.(stepIndex + 1) ?? `Step ${stepIndex + 1}`;

  const status = document.createElement('span');
  status.className = 'dpp-agent-step-status';
  status.textContent = labels?.streaming ?? 'streaming...';

  header.appendChild(indicator);
  header.appendChild(status);

  if (onStop) {
    const stopBtn = document.createElement('button');
    stopBtn.className = 'dpp-agent-stop-btn';
    stopBtn.textContent = labels?.stop ?? 'Stop';
    stopBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onStop();
    });
    header.appendChild(stopBtn);
  }

  const body = document.createElement('div');
  body.className = 'dpp-agent-step-body';

  const tools = document.createElement('div');
  tools.className = 'dpp-agent-step-tools';

  step.appendChild(header);
  step.appendChild(body);
  step.appendChild(tools);

  return step;
}

export function updateStepStreamText(step: HTMLElement, visibleText: string): void {
  const body = step.querySelector<HTMLElement>('.dpp-agent-step-body');
  if (!body) return;

  body.setAttribute('data-dpp-raw-text', visibleText);
  body.innerHTML = renderInlineMarkdown(visibleText);
  scrollStepBodyToBottom(body);
}

function scrollStepBodyToBottom(body: HTMLElement): void {
  body.scrollTop = body.scrollHeight;
  if (typeof requestAnimationFrame !== 'function') return;

  requestAnimationFrame(() => {
    body.scrollTop = body.scrollHeight;
  });
}

export function updateStepStatus(step: HTMLElement, status: string, label?: string): void {
  step.setAttribute('data-status', status);
  const statusEl = step.querySelector('.dpp-agent-step-status');
  if (statusEl && label) statusEl.textContent = label;
  if (status === 'complete' || status === 'error') {
    const stopBtn = step.querySelector('.dpp-agent-stop-btn');
    stopBtn?.remove();
  }
}

export function addToolResultToStep(
  step: HTMLElement,
  toolName: string,
  ok: boolean,
  summary: string,
): void {
  const tools = step.querySelector('.dpp-agent-step-tools');
  if (!tools) return;

  const item = document.createElement('div');
  item.className = `dpp-agent-step-tool-item ${ok ? 'ok' : 'err'}`;
  item.textContent = `${toolName}: ${summary.slice(0, 100)}`;
  tools.appendChild(item);
}

export function createAgentFooter(
  totalSteps: number,
  totalTools: number,
  isError: boolean,
  labelOverride?: string,
  labels?: Partial<InlineAgentRendererLabels>,
): HTMLElement {
  const footer = document.createElement('div');
  footer.className = `dpp-agent-footer ${isError ? 'error' : 'complete'}`;
  if (labelOverride) {
    footer.textContent = labelOverride;
  } else if (isError) {
    footer.textContent = labels?.footerError?.(totalSteps, totalTools) ??
      `Agent error (${totalSteps} steps, ${totalTools} tool calls)`;
  } else {
    footer.textContent = labels?.footerComplete?.(totalSteps, totalTools) ??
      `Agent complete (${totalSteps} steps, ${totalTools} tool calls)`;
  }
  return footer;
}
