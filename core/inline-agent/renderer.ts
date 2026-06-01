const AGENT_STEP_STYLE_ID = 'dpp-inline-agent-css';

export function injectInlineAgentStyles(): void {
  if (document.getElementById(AGENT_STEP_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = AGENT_STEP_STYLE_ID;
  style.textContent = `
    .dpp-agent-container {
      margin-top: 12px;
      border-left: 3px solid #6366f1;
      padding-left: 12px;
    }
    [data-dpp-agent-host-hidden] > :not(.dpp-agent-container):not(.dpp-tool-block) {
      display: none !important;
    }
    .dpp-agent-container[data-restored="true"] {
      margin-bottom: 12px;
    }
    .dpp-agent-step {
      margin-bottom: 8px;
      border: 1px solid var(--dpp-border, #e5e7eb);
      border-radius: 8px;
      overflow: hidden;
      background: var(--dpp-step-bg, #fafafa);
    }
    .dpp-agent-step[data-status="streaming"] {
      border-color: #6366f1;
    }
    .dpp-agent-step[data-status="executing_tools"] {
      border-color: #f59e0b;
    }
    .dpp-agent-step[data-status="error"] {
      border-color: #ef4444;
    }
    .dpp-agent-step-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      font-size: 12px;
      color: var(--dpp-muted, #6b7280);
      background: var(--dpp-header-bg, #f3f4f6);
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
      color: #6366f1;
    }
    .dpp-agent-step-status {
      flex: 1;
    }
    .dpp-agent-stop-btn {
      padding: 2px 8px;
      font-size: 11px;
      border: 1px solid #ef4444;
      border-radius: 4px;
      background: transparent;
      color: #ef4444;
      cursor: pointer;
    }
    .dpp-agent-stop-btn:hover {
      background: #fef2f2;
    }
    .dpp-agent-step-body {
      padding: 8px 10px;
      font-size: 13px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 300px;
      overflow-y: auto;
      transition: max-height 0.3s ease, padding 0.3s ease, opacity 0.2s ease;
    }
    .dpp-agent-step-body:empty {
      display: none;
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
      color: var(--dpp-muted, #6b7280);
      transition: max-height 0.3s ease, padding 0.3s ease, opacity 0.2s ease;
    }
    .dpp-agent-step-tool-item {
      padding: 2px 0;
    }
    .dpp-agent-step-tool-item.ok::before {
      content: '\\2713 ';
      color: #10b981;
    }
    .dpp-agent-step-tool-item.err::before {
      content: '\\2717 ';
      color: #ef4444;
    }
    .dpp-agent-footer {
      margin-top: 8px;
      padding: 6px 0;
      font-size: 12px;
      color: var(--dpp-muted, #6b7280);
    }
    .dpp-agent-footer.complete::before {
      content: '\\25A0 ';
      color: #10b981;
    }
    .dpp-agent-footer.error::before {
      content: '\\25A0 ';
      color: #ef4444;
    }

    body.dpp-theme-dark .dpp-agent-container {
      border-left-color: #818cf8;
    }
    body.dpp-theme-dark .dpp-agent-step {
      background: #1e1e2e;
      border-color: #374151;
    }
    body.dpp-theme-dark .dpp-agent-step-header {
      background: #111827;
      color: #9ca3af;
    }
    body.dpp-theme-dark .dpp-agent-step-body {
      color: #e5e7eb;
    }
    body.dpp-theme-dark .dpp-agent-stop-btn:hover {
      background: #1f1f2e;
    }
    [data-dpp-body-text] {
      font-size: inherit;
      line-height: 1.7;
      margin-top: 12px;
      color: var(--ds-text, #1D1D1F);
      word-break: break-word;
    }
    [data-dpp-body-text] * { color: inherit; }
    [data-dpp-body-text] h3 { font-size: 1.1em; font-weight: 600; margin: 10px 0 4px; }
    [data-dpp-body-text] p { margin: 3px 0; }
    [data-dpp-body-text] ul, [data-dpp-body-text] ol { margin: 3px 0 3px 16px; }
    [data-dpp-body-text] strong { font-weight: 600; }
    [data-dpp-body-text] a { color: var(--ds-blue, #4D6BFE); text-decoration: underline; }
    body.dpp-theme-dark [data-dpp-body-text] {
      color: var(--ds-text, #E5E7EB);
    }
    @media (prefers-color-scheme: dark) {
      body:not(.dpp-theme-light) [data-dpp-body-text] {
        color: var(--ds-text, #E5E7EB);
      }
    }
  `;
  document.head.appendChild(style);
}

export function createAgentContainer(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'dpp-agent-container';
  container.setAttribute('data-dpp-agent', 'true');
  return container;
}

export function createAgentStepElement(stepIndex: number, onStop?: () => void): HTMLElement {
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
  indicator.textContent = `Step ${stepIndex + 1}`;

  const status = document.createElement('span');
  status.className = 'dpp-agent-step-status';
  status.textContent = 'streaming...';

  header.appendChild(indicator);
  header.appendChild(status);

  if (onStop) {
    const stopBtn = document.createElement('button');
    stopBtn.className = 'dpp-agent-stop-btn';
    stopBtn.textContent = 'Stop';
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
  const body = step.querySelector('.dpp-agent-step-body');
  if (body) body.textContent = visibleText;
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
): HTMLElement {
  const footer = document.createElement('div');
  footer.className = `dpp-agent-footer ${isError ? 'error' : 'complete'}`;
  if (labelOverride) {
    footer.textContent = labelOverride;
  } else if (isError) {
    footer.textContent = `Agent 执行出错（${totalSteps} 步，${totalTools} 次工具调用）`;
  } else {
    footer.textContent = `Agent 完成（${totalSteps} 步，${totalTools} 次工具调用）`;
  }
  return footer;
}
