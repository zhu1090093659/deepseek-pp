import type { ToolCall } from '../types';

export const TOOL_CARD_CLASS = 'dpp-tool-card';
export const DSML_HIDDEN_CLASS = 'dpp-dsml-hidden';
const STYLE_ID = 'dpp-tool-card-css';

export interface ToolCardResult {
  ok: boolean;
  summary: string;
  detail?: string;
}

const collapseTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

export function injectToolCardStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = TOOL_CARD_CSS;
  document.head.appendChild(style);
}

export function createToolCard(call: ToolCall): HTMLElement {
  injectToolCardStyles();

  const card = document.createElement('div');
  card.className = TOOL_CARD_CLASS;
  card.setAttribute('data-state', 'running');
  card.setAttribute('data-collapsed', 'false');

  card.innerHTML = `
    <div class="dpp-tc-header" role="button" tabindex="0" aria-expanded="true">
      <span class="dpp-tc-icon" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
      </span>
      <span class="dpp-tc-name"></span>
      <span class="dpp-tc-status">
        <span class="dpp-tc-spinner" aria-hidden="true"></span>
        <span class="dpp-tc-status-text">执行中</span>
      </span>
      <span class="dpp-tc-chevron" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </span>
    </div>
    <div class="dpp-tc-body">
      <div class="dpp-tc-section">
        <div class="dpp-tc-label">参数</div>
        <div class="dpp-tc-payload"></div>
      </div>
      <div class="dpp-tc-section dpp-tc-result-section" data-hidden="true">
        <div class="dpp-tc-label">结果</div>
        <div class="dpp-tc-result"></div>
      </div>
    </div>
  `;

  const nameEl = card.querySelector('.dpp-tc-name') as HTMLElement;
  nameEl.textContent = call.name;

  const payloadEl = card.querySelector('.dpp-tc-payload') as HTMLElement;
  renderPayload(payloadEl, call.payload);

  const header = card.querySelector('.dpp-tc-header') as HTMLElement;
  header.addEventListener('click', () => toggleCollapse(card));
  header.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleCollapse(card);
    }
  });

  return card;
}

export function setToolCardResult(card: HTMLElement, result: ToolCardResult) {
  card.setAttribute('data-state', result.ok ? 'success' : 'error');

  const statusText = card.querySelector('.dpp-tc-status-text');
  if (statusText) statusText.textContent = result.summary;

  const spinner = card.querySelector('.dpp-tc-spinner');
  if (spinner) spinner.remove();

  if (result.detail) {
    const resultSection = card.querySelector('.dpp-tc-result-section') as HTMLElement | null;
    const resultEl = card.querySelector('.dpp-tc-result') as HTMLElement | null;
    if (resultSection && resultEl) {
      resultEl.textContent = result.detail;
      resultSection.removeAttribute('data-hidden');
    }
  }
}

export function autoCollapseToolCard(card: HTMLElement, delayMs = 2000) {
  cancelCollapseTimer(card);
  const timer = setTimeout(() => {
    collapseTimers.delete(card);
    if (card.getAttribute('data-collapsed') !== 'true') {
      setCollapsed(card, true);
    }
  }, delayMs);
  collapseTimers.set(card, timer);
}

function cancelCollapseTimer(card: HTMLElement) {
  const existing = collapseTimers.get(card);
  if (existing) {
    clearTimeout(existing);
    collapseTimers.delete(card);
  }
}

function toggleCollapse(card: HTMLElement) {
  const collapsed = card.getAttribute('data-collapsed') === 'true';
  setCollapsed(card, !collapsed);
  cancelCollapseTimer(card);
}

function setCollapsed(card: HTMLElement, collapsed: boolean) {
  card.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
  const header = card.querySelector('.dpp-tc-header');
  header?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}

function renderPayload(target: HTMLElement, payload: Record<string, unknown>) {
  target.innerHTML = '';
  const entries = Object.entries(payload);
  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'dpp-tc-payload-empty';
    empty.textContent = '（无参数）';
    target.appendChild(empty);
    return;
  }

  for (const [key, value] of entries) {
    const row = document.createElement('div');
    row.className = 'dpp-tc-payload-row';

    const keyEl = document.createElement('span');
    keyEl.className = 'dpp-tc-key';
    keyEl.textContent = key;

    const valEl = document.createElement('span');
    valEl.className = 'dpp-tc-value';
    valEl.textContent = formatValue(value);

    row.appendChild(keyEl);
    row.appendChild(document.createTextNode(': '));
    row.appendChild(valEl);
    target.appendChild(row);
  }
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const TOOL_CARD_CSS = `
.dpp-tool-card {
  margin: 8px 0;
  background: #FFFFFF;
  border: 1px solid #E5E7EB;
  border-radius: 12px;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Noto Sans SC', 'Segoe UI', sans-serif;
  font-size: 13px;
  overflow: hidden;
  transition: border-color 0.2s, box-shadow 0.2s;
  animation: dpp-tc-in 0.2s ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}
.dpp-tool-card:hover {
  border-color: #D1D5DB;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}
@keyframes dpp-tc-in {
  from { opacity: 0; transform: translateY(-2px); }
  to { opacity: 1; transform: translateY(0); }
}
.dpp-tool-card[data-state="success"] { border-color: #BBF7D0; }
.dpp-tool-card[data-state="error"]   { border-color: #FECACA; }

.dpp-tc-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  background: #F7F8FA;
  border-bottom: 1px solid transparent;
  transition: background 0.12s, border-color 0.2s;
}
.dpp-tool-card[data-collapsed="false"] .dpp-tc-header {
  border-bottom-color: #EEF0F2;
}
.dpp-tc-header:hover { background: #EFF1F4; }
.dpp-tc-header:focus { outline: none; box-shadow: inset 0 0 0 2px rgba(77, 107, 254, 0.2); }

.dpp-tc-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: #EEF1FF;
  color: #4D6BFE;
  flex-shrink: 0;
}
.dpp-tool-card[data-state="success"] .dpp-tc-icon { background: #ECFDF5; color: #10B981; }
.dpp-tool-card[data-state="error"]   .dpp-tc-icon { background: #FEF2F2; color: #EF4444; }

.dpp-tc-name {
  font-family: 'SF Mono', Monaco, Menlo, Consolas, monospace;
  font-size: 12px;
  font-weight: 600;
  color: #1D1D1F;
  flex-shrink: 0;
}
.dpp-tc-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #6B7280;
  flex: 1;
  min-width: 0;
}
.dpp-tc-status-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dpp-tool-card[data-state="success"] .dpp-tc-status-text { color: #10B981; }
.dpp-tool-card[data-state="error"]   .dpp-tc-status-text { color: #EF4444; }

.dpp-tc-spinner {
  width: 11px;
  height: 11px;
  border: 1.5px solid #E5E7EB;
  border-top-color: #4D6BFE;
  border-radius: 50%;
  animation: dpp-tc-spin 0.8s linear infinite;
  flex-shrink: 0;
}
@keyframes dpp-tc-spin {
  to { transform: rotate(360deg); }
}

.dpp-tc-chevron {
  display: inline-flex;
  color: #9CA3AF;
  transition: transform 0.22s ease;
  flex-shrink: 0;
}
.dpp-tool-card[data-collapsed="true"] .dpp-tc-chevron { transform: rotate(-90deg); }

.dpp-tc-body {
  max-height: 2000px;
  overflow: hidden;
  transition: max-height 0.3s ease, opacity 0.2s ease;
  opacity: 1;
}
.dpp-tool-card[data-collapsed="true"] .dpp-tc-body {
  max-height: 0;
  opacity: 0;
}

.dpp-tc-section {
  padding: 10px 12px;
}
.dpp-tc-section + .dpp-tc-section {
  border-top: 1px dashed #EEF0F2;
}
.dpp-tc-section[data-hidden] { display: none; }

.dpp-tc-label {
  font-size: 10px;
  font-weight: 600;
  color: #9CA3AF;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  margin-bottom: 6px;
}

.dpp-tc-payload {
  font-family: 'SF Mono', Monaco, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.65;
  color: #1D1D1F;
  white-space: pre-wrap;
  word-break: break-word;
}
.dpp-tc-payload-row { display: block; }
.dpp-tc-payload-empty { color: #9CA3AF; font-style: italic; }

.dpp-tc-key {
  color: #6B7280;
}
.dpp-tc-value {
  color: #1D1D1F;
}

.dpp-tc-result {
  font-size: 12px;
  color: #1D1D1F;
  line-height: 1.55;
  word-break: break-word;
  white-space: pre-wrap;
}

@media (prefers-color-scheme: dark) {
  .dpp-tool-card {
    background: #1F1F1F;
    border-color: #2E2E2E;
    box-shadow: none;
  }
  .dpp-tool-card:hover { border-color: #3A3A3A; }
  .dpp-tool-card[data-state="success"] { border-color: #134E32; }
  .dpp-tool-card[data-state="error"]   { border-color: #4C1F1F; }
  .dpp-tc-header { background: #262626; border-bottom-color: transparent; }
  .dpp-tool-card[data-collapsed="false"] .dpp-tc-header { border-bottom-color: #2E2E2E; }
  .dpp-tc-header:hover { background: #2E2E2E; }
  .dpp-tc-icon { background: rgba(77, 107, 254, 0.15); }
  .dpp-tool-card[data-state="success"] .dpp-tc-icon { background: rgba(16, 185, 129, 0.15); }
  .dpp-tool-card[data-state="error"]   .dpp-tc-icon { background: rgba(239, 68, 68, 0.15); }
  .dpp-tc-name, .dpp-tc-payload, .dpp-tc-value, .dpp-tc-result { color: #E5E5E5; }
  .dpp-tc-key, .dpp-tc-status, .dpp-tc-label, .dpp-tc-payload-empty { color: #9CA3AF; }
  .dpp-tc-section + .dpp-tc-section { border-top-color: #2E2E2E; }
  .dpp-tc-spinner { border-color: #3A3A3A; border-top-color: #4D6BFE; }
}

.dpp-dsml-hidden { display: none !important; }
`;
