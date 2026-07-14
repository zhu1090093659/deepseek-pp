import type { ToolCardResult } from '../types';
import type { ArtifactOutput, ArtifactRuntimeLanguage } from '../artifact';
import { DEFAULT_LOCALE, translate, type SupportedLocale } from '../i18n';
import { injectInjectedThemeStyles } from './injected-theme';

export type ToolResultRendererInput = {
  target: HTMLElement;
  result: ToolCardResult;
  locale?: SupportedLocale;
  sendMessage: <T = unknown>(message: unknown) => Promise<T | undefined>;
};

export type ToolResultRenderer = (input: ToolResultRendererInput) => boolean;

const renderers: ToolResultRenderer[] = [];
let artifactPreviewRoute: string | null = null;
let artifactPreviewRouteTimer: number | null = null;

export function registerToolResultRenderer(renderer: ToolResultRenderer): void {
  if (!renderers.includes(renderer)) renderers.push(renderer);
}

export function renderToolResultWithRegistry(input: ToolResultRendererInput): boolean {
  for (const renderer of renderers) {
    if (renderer(input)) return true;
  }
  return false;
}

export function registerDefaultToolResultRenderers(): void {
  registerToolResultRenderer(renderArtifactResult);
  registerToolResultRenderer(renderSkillDraftResult);
  registerToolResultRenderer(renderMemoryImportPreviewResult);
}

function renderSkillDraftResult(input: ToolResultRendererInput): boolean {
  const draft = getSkillDraftOutput(input.result.output);
  if (!draft) return false;

  const locale = input.locale ?? DEFAULT_LOCALE;
  const memoryKey = draft.draft.memoryEnabled ? 'tool.skillCreator.result.memoryOn' : 'tool.skillCreator.result.memoryOff';
  const wrapper = createResultPanel('dpp-skill-draft-result');
  const meta = document.createElement('div');
  meta.className = 'dpp-result-meta';
  meta.textContent = `/${draft.draft.name} · ${translate(locale, memoryKey)}`;
  const description = document.createElement('div');
  description.className = 'dpp-result-text';
  description.textContent = draft.draft.description;
  const button = createSmallButton(translate(locale, 'tool.skillCreator.result.saveSkill'));
  button.addEventListener('click', () => {
    void saveSkillDraft(draft.draft, input.sendMessage, button, locale);
  });
  wrapper.append(meta, description, button);
  input.target.appendChild(wrapper);
  ensureResultStyles();
  return true;
}

async function saveSkillDraft(
  draft: unknown,
  sendMessage: <T = unknown>(message: unknown) => Promise<T | undefined>,
  button: HTMLButtonElement,
  locale: SupportedLocale,
): Promise<void> {
  button.disabled = true;
  const previous = button.textContent;
  button.textContent = translate(locale, 'tool.skillCreator.result.saving');
  try {
    const result = await sendMessage<{ ok?: boolean; error?: string }>({
      type: 'SAVE_SKILL',
      payload: draft,
    });
    if (result?.ok !== true) {
      throw new Error(result?.error || translate(locale, 'tool.skillCreator.result.saveFailed'));
    }
    button.textContent = translate(locale, 'tool.skillCreator.result.saved');
  } catch (error) {
    button.textContent = error instanceof Error ? error.message : translate(locale, 'tool.skillCreator.result.saveFailed');
  } finally {
    setTimeout(() => {
      button.disabled = false;
      button.textContent = previous;
    }, 2000);
  }
}

function renderMemoryImportPreviewResult(input: ToolResultRendererInput): boolean {
  const preview = getMemoryImportPreviewOutput(input.result.output);
  if (!preview) return false;

  const locale = input.locale ?? DEFAULT_LOCALE;
  const wrapper = createResultPanel('dpp-memory-import-result');
  const meta = document.createElement('div');
  meta.className = 'dpp-result-meta';
  meta.textContent = translate(locale, 'tool.memoryImport.result.metaSummary', { count: preview.memories.length, duplicates: preview.duplicates });
  const list = document.createElement('div');
  list.className = 'dpp-result-text';
  list.textContent = preview.memories.slice(0, 5).map((memory) => `- ${memory.name}`).join('\n');
  const button = createSmallButton(translate(locale, 'tool.memoryImport.result.importMemories'));
  button.disabled = preview.memories.length === 0;
  button.addEventListener('click', () => {
    void importMemoryDrafts(preview.memories, input.sendMessage, button, locale);
  });
  wrapper.append(meta, list, button);
  input.target.appendChild(wrapper);
  ensureResultStyles();
  return true;
}

async function importMemoryDrafts(
  memories: unknown[],
  sendMessage: <T = unknown>(message: unknown) => Promise<T | undefined>,
  button: HTMLButtonElement,
  locale: SupportedLocale,
): Promise<void> {
  button.disabled = true;
  const previous = button.textContent;
  button.textContent = translate(locale, 'tool.memoryImport.result.importing');
  try {
    const result = await sendMessage<{ ok?: boolean; count?: number; error?: string }>({
      type: 'IMPORT_MEMORY_DRAFTS',
      payload: { memories },
    });
    if (result?.ok === false) throw new Error(result.error || translate(locale, 'tool.memoryImport.result.importFailed'));
    button.textContent = translate(locale, 'tool.memoryImport.result.imported', { count: result?.count ?? memories.length });
  } catch (error) {
    button.textContent = error instanceof Error ? error.message : translate(locale, 'tool.memoryImport.result.importFailed');
  } finally {
    setTimeout(() => {
      button.disabled = false;
      button.textContent = previous;
    }, 2000);
  }
}

function renderArtifactResult(input: ToolResultRendererInput): boolean {
  const artifact = getArtifactOutput(input.result.output);
  if (!artifact) return false;

  const locale = input.locale ?? DEFAULT_LOCALE;
  const wrapper = document.createElement('div');
  wrapper.className = 'dpp-artifact-result';
  const meta = document.createElement('div');
  meta.className = 'dpp-artifact-meta';
  meta.textContent = `${artifact.filename} · ${formatBytes(artifact.sizeBytes)}${artifact.fileCount ? ` · ${translate(locale, 'tool.artifact.result.files', { count: artifact.fileCount })}` : ''}`;
  const actions = document.createElement('div');
  actions.className = 'dpp-artifact-actions';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dpp-artifact-download';
  button.textContent = translate(locale, 'tool.artifact.result.download');
  button.addEventListener('click', () => {
    void downloadArtifact(artifact, input.sendMessage, button, locale);
  });
  actions.appendChild(button);

  const output = document.createElement('pre');
  output.className = 'dpp-artifact-run-output';
  output.hidden = true;

  if (isRunnableCodeArtifact(artifact)) {
    const runButton = document.createElement('button');
    runButton.type = 'button';
    runButton.className = 'dpp-artifact-run';
    runButton.textContent = translate(locale, 'tool.artifact.result.run');
    runButton.addEventListener('click', () => {
      void runArtifactCode(artifact, input.sendMessage, runButton, output, locale);
    });
    actions.prepend(runButton);
  }

  if (isHtmlPreviewArtifact(artifact)) {
    const previewButton = document.createElement('button');
    previewButton.type = 'button';
    previewButton.className = 'dpp-artifact-preview';
    previewButton.textContent = translate(locale, 'tool.artifact.result.preview');
    previewButton.addEventListener('click', () => {
      void openArtifactPreviewPanel(artifact, input.sendMessage, locale);
    });
    actions.prepend(previewButton);
  }

  wrapper.append(meta, actions);
  input.target.appendChild(wrapper);
  if (isRunnableCodeArtifact(artifact)) input.target.appendChild(output);
  ensureArtifactStyles();
  return true;
}

function isHtmlPreviewArtifact(artifact: ArtifactOutput): boolean {
  return artifact.artifactKind === 'file' &&
    artifact.view?.previewMode === 'html' &&
    artifact.view.language === 'html';
}

function isRunnableCodeArtifact(artifact: ArtifactOutput): boolean {
  return artifact.artifactKind === 'file' &&
    artifact.view?.previewMode === 'code' &&
    isRunnableArtifactLanguage(artifact.view.language);
}

function isRunnableArtifactLanguage(language: ArtifactRuntimeLanguage): language is 'javascript' | 'typescript' | 'python' {
  return language === 'javascript' || language === 'typescript' || language === 'python';
}

async function openArtifactPreviewPanel(
  artifact: ArtifactOutput,
  sendMessage: <T = unknown>(message: unknown) => Promise<T | undefined>,
  locale: SupportedLocale,
): Promise<void> {
  ensureResultStyles();
  closeArtifactPreviewPanel();

  const panel = document.createElement('section');
  panel.className = 'dpp-artifact-preview-panel';
  panel.setAttribute('aria-label', translate(locale, 'tool.artifact.result.previewAriaLabel'));
  const header = document.createElement('div');
  header.className = 'dpp-artifact-preview-panel-header';
  const title = document.createElement('div');
  title.className = 'dpp-artifact-preview-panel-title';
  title.textContent = artifact.filename;
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'dpp-artifact-preview-panel-close';
  closeButton.setAttribute('aria-label', translate(locale, 'tool.artifact.result.closePreview'));
  closeButton.textContent = 'x';
  closeButton.addEventListener('click', closeArtifactPreviewPanel);
  header.append(title, closeButton);

  const stage = document.createElement('div');
  stage.className = 'dpp-artifact-preview-panel-stage';
  const frame = document.createElement('iframe');
  frame.className = 'dpp-artifact-preview-panel-frame';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('title', artifact.filename);
  stage.appendChild(frame);
  panel.append(header, stage);
  document.body.appendChild(panel);
  document.body.classList.add('dpp-artifact-preview-panel-open');
  startArtifactPreviewRouteWatcher(location.href);

  try {
    const record = await getArtifactRecord(artifact, sendMessage, locale);
    if (!panel.isConnected) return;
    frame.srcdoc = record.content;
  } catch (error) {
    if (!panel.isConnected) return;
    frame.remove();
    const message = document.createElement('div');
    message.className = 'dpp-artifact-preview-error';
    message.textContent = error instanceof Error ? error.message : translate(locale, 'tool.artifact.result.previewFailed');
    stage.appendChild(message);
  }
}

function closeArtifactPreviewPanel(): void {
  document.querySelector('.dpp-artifact-preview-panel')?.remove();
  document.body.classList.remove('dpp-artifact-preview-panel-open');
  stopArtifactPreviewRouteWatcher();
}

function startArtifactPreviewRouteWatcher(route: string): void {
  artifactPreviewRoute = route;
  window.addEventListener('popstate', closeArtifactPreviewPanelIfRouteChanged);
  window.addEventListener('hashchange', closeArtifactPreviewPanelIfRouteChanged);

  if (!artifactPreviewRouteTimer) {
    artifactPreviewRouteTimer = window.setInterval(closeArtifactPreviewPanelIfRouteChanged, 250);
  }
}

function stopArtifactPreviewRouteWatcher(): void {
  artifactPreviewRoute = null;
  window.removeEventListener('popstate', closeArtifactPreviewPanelIfRouteChanged);
  window.removeEventListener('hashchange', closeArtifactPreviewPanelIfRouteChanged);
  if (!artifactPreviewRouteTimer) return;
  window.clearInterval(artifactPreviewRouteTimer);
  artifactPreviewRouteTimer = null;
}

function closeArtifactPreviewPanelIfRouteChanged(): void {
  if (!artifactPreviewRoute || location.href === artifactPreviewRoute) return;
  closeArtifactPreviewPanel();
}

async function downloadArtifact(
  artifact: ArtifactOutput,
  sendMessage: <T = unknown>(message: unknown) => Promise<T | undefined>,
  button: HTMLButtonElement,
  locale: SupportedLocale,
): Promise<void> {
  button.disabled = true;
  const previous = button.textContent;
  button.textContent = translate(locale, 'tool.artifact.result.downloading');
  try {
    const record = await getArtifactRecord(artifact, sendMessage, locale);
    const content = record.kind === 'bundle'
      ? base64ToBlob(record.content, record.mimeType)
      : new Blob([record.content], { type: record.mimeType });
    const url = URL.createObjectURL(content);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = record.filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    button.textContent = translate(locale, 'tool.artifact.result.downloaded');
  } catch (error) {
    button.textContent = error instanceof Error ? error.message : translate(locale, 'tool.artifact.result.downloadFailed');
  } finally {
    setTimeout(() => {
      button.disabled = false;
      button.textContent = previous;
    }, 2000);
  }
}

async function runArtifactCode(
  artifact: ArtifactOutput,
  sendMessage: <T = unknown>(message: unknown) => Promise<T | undefined>,
  button: HTMLButtonElement,
  output: HTMLPreElement,
  locale: SupportedLocale,
): Promise<void> {
  const language = artifact.view?.language;
  if (!language || !isRunnableArtifactLanguage(language)) return;

  button.disabled = true;
  const previous = button.textContent;
  button.textContent = translate(locale, 'tool.artifact.result.running');
  output.hidden = false;
  output.textContent = '';

  try {
    const record = await getArtifactRecord(artifact, sendMessage, locale);
    const result = await runArtifactThroughBackground(record.content, language, sendMessage, locale);
    output.textContent = formatArtifactRunResult(result, locale);
    button.textContent = result.ok ? translate(locale, 'tool.artifact.result.runAgain') : translate(locale, 'tool.artifact.result.failed');
  } catch (error) {
    output.textContent = error instanceof Error ? error.message : String(error);
    button.textContent = translate(locale, 'tool.artifact.result.failed');
  } finally {
    setTimeout(() => {
      button.disabled = false;
      button.textContent = previous;
    }, 2000);
  }
}

async function getArtifactRecord(
  artifact: ArtifactOutput,
  sendMessage: <T = unknown>(message: unknown) => Promise<T | undefined>,
  locale: SupportedLocale,
): Promise<{ filename: string; mimeType: string; content: string; kind: string }> {
  if (typeof artifact.transientContent === 'string') {
    return {
      filename: artifact.filename,
      mimeType: artifact.mimeType,
      content: artifact.transientContent,
      kind: artifact.artifactKind,
    };
  }

  const record = await sendMessage<{ ok?: boolean; artifact?: { filename: string; mimeType: string; content: string; kind: string } }>({
    type: 'GET_ARTIFACT',
    payload: { id: artifact.artifactId },
  });
  if (!record?.artifact) throw new Error(translate(locale, 'tool.artifact.result.artifactNotFound'));
  return record.artifact;
}

async function runArtifactThroughBackground(
  code: string,
  language: 'javascript' | 'typescript' | 'python',
  sendMessage: <T = unknown>(message: unknown) => Promise<T | undefined>,
  locale: SupportedLocale,
): Promise<ToolCardResult> {
  const result = await sendMessage<ToolCardResult>({
    type: 'RUN_ARTIFACT_CODE',
    payload: {
      language,
      code,
      timeoutMs: language === 'python' ? 15_000 : 5_000,
    },
  });
  if (!result) throw new Error(translate(locale, 'tool.artifact.result.runnerUnavailable'));
  return result;
}

function formatArtifactRunResult(result: ToolCardResult, locale: SupportedLocale): string {
  const output = result.output && typeof result.output === 'object'
    ? result.output as Record<string, unknown>
    : {};
  const lines = [
    translate(locale, result.ok ? 'tool.artifact.result.codeExecuted' : 'tool.artifact.result.codeFailed'),
    result.detail && !output.stdout && !output.stderr && !output.result ? String(result.detail) : '',
    typeof output.stdout === 'string' && output.stdout ? `stdout:\n${output.stdout}` : '',
    typeof output.stderr === 'string' && output.stderr ? `stderr:\n${output.stderr}` : '',
    typeof output.result === 'string' && output.result ? `result:\n${output.result}` : '',
    result.error?.message ? `error:\n${result.error.message}` : '',
  ];
  return lines.filter(Boolean).join('\n\n') || translate(locale, result.ok ? 'tool.artifact.result.done' : 'tool.artifact.result.failed');
}

function getArtifactOutput(value: unknown): ArtifactOutput | null {
  if (!value || typeof value !== 'object') return null;
  const output = value as ArtifactOutput;
  if (output.kind !== 'artifact') return null;
  if (typeof output.artifactId !== 'string' || typeof output.filename !== 'string') return null;
  if (typeof output.mimeType !== 'string' || typeof output.sizeBytes !== 'number') return null;
  return output;
}

function getSkillDraftOutput(value: unknown): { kind: 'skill_draft'; draft: { name: string; description: string; instructions: string; memoryEnabled: boolean } } | null {
  if (!value || typeof value !== 'object') return null;
  const output = value as { kind?: unknown; draft?: unknown };
  if (output.kind !== 'skill_draft' || !output.draft || typeof output.draft !== 'object') return null;
  const draft = output.draft as { name?: unknown; description?: unknown; instructions?: unknown; memoryEnabled?: unknown };
  if (typeof draft.name !== 'string' || typeof draft.description !== 'string' || typeof draft.instructions !== 'string') return null;
  return value as { kind: 'skill_draft'; draft: { name: string; description: string; instructions: string; memoryEnabled: boolean } };
}

function getMemoryImportPreviewOutput(value: unknown): { kind: 'memory_import_preview'; memories: Array<{ name: string }>; duplicates: number; rejected: number } | null {
  if (!value || typeof value !== 'object') return null;
  const output = value as { kind?: unknown; memories?: unknown; duplicates?: unknown; rejected?: unknown };
  if (output.kind !== 'memory_import_preview' || !Array.isArray(output.memories)) return null;
  if (typeof output.duplicates !== 'number' || typeof output.rejected !== 'number') return null;
  return value as { kind: 'memory_import_preview'; memories: Array<{ name: string }>; duplicates: number; rejected: number };
}

function createResultPanel(className: string): HTMLDivElement {
  const wrapper = document.createElement('div');
  wrapper.className = `dpp-rich-result ${className}`;
  return wrapper;
}

function createSmallButton(text: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dpp-result-action';
  button.textContent = text;
  return button;
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ensureArtifactStyles(): void {
  ensureResultStyles();
}

function ensureResultStyles(): void {
  injectInjectedThemeStyles();
  if (document.getElementById('dpp-artifact-result-css')) return;
  const style = document.createElement('style');
  style.id = 'dpp-artifact-result-css';
  style.textContent = `
.dpp-artifact-result,
.dpp-rich-result {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--dpp-ui-border);
  border-radius: 8px;
  background: var(--dpp-ui-accent-panel);
}
.dpp-artifact-meta {
  min-width: 0;
  font-size: 12px;
  color: var(--dpp-ui-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dpp-artifact-actions {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 6px;
  align-items: center;
}
.dpp-rich-result {
  display: block;
}
.dpp-result-meta {
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--dpp-ui-text);
}
.dpp-result-text {
  margin-top: 6px;
  white-space: pre-wrap;
  font-size: 12px;
  color: var(--dpp-ui-text-muted);
}
.dpp-artifact-preview-panel {
  position: fixed;
  top: 0;
  right: 0;
  z-index: 2147483000;
  display: flex;
  width: min(48vw, 760px);
  min-width: 420px;
  height: 100vh;
  height: 100dvh;
  flex-direction: column;
  border-left: 1px solid var(--dpp-ui-border);
  background: var(--dpp-ui-surface);
  box-shadow: var(--dpp-ui-panel-shadow);
  color: var(--dpp-ui-text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.dpp-artifact-preview-panel-header {
  display: flex;
  min-height: 54px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 16px;
  border-bottom: 1px solid var(--dpp-ui-border-muted);
  background: var(--dpp-ui-surface-muted);
  color: var(--dpp-ui-text);
  font-size: 14px;
  line-height: 20px;
}
.dpp-artifact-preview-panel-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.dpp-artifact-preview-panel-close {
  display: inline-flex;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--dpp-ui-text-muted);
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
}
.dpp-artifact-preview-panel-close:hover {
  background: var(--dpp-ui-surface-hover);
}
.dpp-artifact-preview-panel-stage {
  flex: 1 1 auto;
  min-height: 0;
  background: #FFFFFF;
}
.dpp-artifact-preview-panel-frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: #FFFFFF;
}
.dpp-artifact-preview-error {
  padding: 16px;
  color: var(--dpp-ui-error);
  font-size: 12px;
}
.dpp-result-code,
.dpp-result-output,
.dpp-artifact-run-output {
  margin: 8px 0 0;
  max-height: 160px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  border-radius: 7px;
  background: var(--dpp-ui-code-bg);
  color: var(--dpp-ui-text);
  font-size: 11px;
  line-height: 1.45;
  padding: 8px;
}
.dpp-result-action,
.dpp-artifact-download,
.dpp-artifact-preview,
.dpp-artifact-run {
  border: 0;
  border-radius: 7px;
  background: var(--dpp-ui-accent);
  color: white;
  font-size: 11px;
  font-weight: 600;
  padding: 5px 9px;
  cursor: pointer;
}
.dpp-result-action {
  margin-top: 8px;
}
.dpp-artifact-download {
  background: var(--dpp-ui-accent-soft);
  color: var(--dpp-ui-accent-strong);
}
.dpp-result-action:disabled,
.dpp-artifact-download:disabled,
.dpp-artifact-preview:disabled,
.dpp-artifact-run:disabled {
  opacity: 0.65;
  cursor: default;
}
body.dpp-theme-dark .dpp-artifact-preview-panel-stage {
  background: #FFFFFF;
}
@media (max-width: 900px) {
  .dpp-artifact-preview-panel {
    width: 100vw;
    min-width: 0;
  }
}
`;
  document.head.appendChild(style);
}
