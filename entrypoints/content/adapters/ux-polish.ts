import { createMessageMarkdownArtifact } from '../../../core/export/secondary-artifacts';
import {
  createBrowserDownloadManager,
  type BrowserDownloadManager,
} from '../download-manager';

export interface ContentUxPolishController {
  stop(): void;
  refreshLabels(): void;
}

export interface ContentUxPolishLabels {
  codeDownloadButton: string;
  messageMarkdownButton: string;
  messageMarkdownTitle: string;
  messageCopyButton: string;
  messageCopyTitle: string;
  messageCopyFailed: string;
  saveDirButton: string;
  saveDirButtonTitle: string;
  saveDirPlaceholder: string;
  saveDirInputTitle: string;
  saveDirMissingDir: string;
  saveDirSaved: string;
  saveDirDegraded: string;
}

const STYLE_ID = 'dpp-content-ux-polish-css';
const CODE_BUTTON_CLASS = 'dpp-code-download';
const MESSAGE_BUTTON_CLASS = 'dpp-message-download';
const MESSAGE_COPY_CLASS = 'dpp-message-copy';
const MESSAGE_SAVE_DIR_CLASS = 'dpp-message-save-dir';
const MD_DIR_INPUT_CLASS = 'dpp-md-dir-input';
const LAST_MD_DIR_STORAGE_KEY = 'lastMdDir';
const PRIMARY_MESSAGE_SELECTOR = [
  '.ds-message',
  '[data-message-id][data-message-role]',
  '[data-message-author-role]',
].join(', ');
const VIRTUAL_MESSAGE_SELECTOR =
  '.ds-virtual-list--printable .ds-virtual-list-visible-items > [data-virtual-list-item-key]';
const MESSAGE_SELECTOR = `${PRIMARY_MESSAGE_SELECTOR}, ${VIRTUAL_MESSAGE_SELECTOR}`;
const ASSISTANT_CONTENT_SELECTOR = '._74c0879, .ds-assistant-message-main-content';
const POLISH_MOUNT_DELAY_MS = 50;
const CODE_BUTTON_OFFSET_PX = 6;
const MESSAGE_COPY_STATUS_MS = 1600;

export function startContentUxPolish(
  getLabels: () => ContentUxPolishLabels,
): ContentUxPolishController {
  injectStyles();
  const codeButtons = new Map<HTMLElement, HTMLButtonElement>();
  const copyFeedbackTimers = new Set<ReturnType<typeof setTimeout>>();
  const downloads = createBrowserDownloadManager();
  const syncCodeButtons = () => syncCodeButtonPositions(codeButtons);
  const mount = () => mountPolish(document, getLabels(), codeButtons, copyFeedbackTimers, downloads);
  const refreshLabels = () => applyPolishLabels(document, getLabels());
  mount();
  const candidateMountScheduler = createCandidateMountScheduler(getLabels, copyFeedbackTimers, downloads);
  const observer = new MutationObserver((mutations) => {
    for (const root of collectPolishCandidateRoots(mutations)) {
      candidateMountScheduler.schedule(root, codeButtons);
    }
    syncCodeButtons();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('dpp:navigation', mount);
  window.addEventListener('scroll', syncCodeButtons, true);
  window.addEventListener('resize', syncCodeButtons);

  return {
    refreshLabels,
    stop() {
      observer.disconnect();
      candidateMountScheduler.cancel();
      downloads.stop();
      copyFeedbackTimers.forEach((timer) => clearTimeout(timer));
      copyFeedbackTimers.clear();
      window.removeEventListener('dpp:navigation', mount);
      window.removeEventListener('scroll', syncCodeButtons, true);
      window.removeEventListener('resize', syncCodeButtons);
      codeButtons.forEach((button) => button.remove());
      codeButtons.clear();
      document.querySelectorAll(`.${MESSAGE_BUTTON_CLASS}, .${MESSAGE_COPY_CLASS}, .${MESSAGE_SAVE_DIR_CLASS}, .${MD_DIR_INPUT_CLASS}`).forEach((node) => node.remove());
      document.getElementById(STYLE_ID)?.remove();
    },
  };
}

export function collectCodeBlocks(root: ParentNode): HTMLElement[] {
  return queryIncludingRoot<HTMLElement>(root, 'pre');
}

export function inferCodeFilename(codeBlock: HTMLElement, index = 0): string {
  const languageClass = Array.from(codeBlock.querySelector('code')?.classList ?? [])
    .find((className) => className.startsWith('language-'));
  const language = languageClass?.replace(/^language-/, '') || codeBlock.getAttribute('data-language') || 'txt';
  const ext = extensionForLanguage(language);
  return `deepseek-code-${index + 1}.${ext}`;
}

function mountPolish(
  root: ParentNode,
  labels: ContentUxPolishLabels,
  codeButtons: Map<HTMLElement, HTMLButtonElement>,
  copyFeedbackTimers: Set<ReturnType<typeof setTimeout>>,
  downloads: BrowserDownloadManager,
): void {
  collectCodeBlocks(root).forEach((pre, index) => mountCodeDownload(pre, index, labels, codeButtons, downloads));
  collectMessageNodes(root).forEach((message) => mountMessageActions(message, labels, copyFeedbackTimers, downloads));
  applyPolishLabels(root, labels);
  syncCodeButtonPositions(codeButtons);
}

function mountCodeDownload(
  pre: HTMLElement,
  index: number,
  labels: ContentUxPolishLabels,
  codeButtons: Map<HTMLElement, HTMLButtonElement>,
  downloads: BrowserDownloadManager,
): void {
  if (codeButtons.has(pre)) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = CODE_BUTTON_CLASS;
  button.textContent = labels.codeDownloadButton;
  button.title = labels.codeDownloadButton;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    downloads.download(
      inferCodeFilename(pre, index),
      new Blob([getCodeBlockText(pre)], { type: 'text/plain;charset=utf-8' }),
    );
  });
  document.body.appendChild(button);
  codeButtons.set(pre, button);
  positionCodeButton(pre, button);
}

export function getCodeBlockText(pre: HTMLElement): string {
  const code = pre.querySelector('code');
  if (code?.textContent) return code.textContent;
  const clone = pre.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(`.${CODE_BUTTON_CLASS}`).forEach((node) => node.remove());
  return clone.textContent ?? '';
}

function collectMessageNodes(root: ParentNode): HTMLElement[] {
  return queryIncludingRoot<HTMLElement>(root, MESSAGE_SELECTOR)
    .filter((node) => !node.matches(VIRTUAL_MESSAGE_SELECTOR) || !node.querySelector(PRIMARY_MESSAGE_SELECTOR))
    .filter((node) => !node.querySelector(`:scope > .${MESSAGE_BUTTON_CLASS}, :scope > .${MESSAGE_COPY_CLASS}, :scope > .${MESSAGE_SAVE_DIR_CLASS}, :scope > .${MD_DIR_INPUT_CLASS}`))
    .filter((node) => node.textContent?.trim());
}

function mountMessageActions(
  message: HTMLElement,
  labels: ContentUxPolishLabels,
  copyFeedbackTimers: Set<ReturnType<typeof setTimeout>>,
  downloads: BrowserDownloadManager,
): void {
  const markdownButton = document.createElement('button');
  markdownButton.type = 'button';
  markdownButton.className = MESSAGE_BUTTON_CLASS;
  markdownButton.textContent = labels.messageMarkdownButton;
  markdownButton.title = labels.messageMarkdownTitle;
  markdownButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const artifact = createMessageMarkdownArtifact({
      id: message.dataset.messageId || message.dataset.virtualListItemKey || `dom-${Date.now()}`,
      role: getMessageRole(message),
      content: getMessageText(message),
      createdAt: null,
    });
    downloads.download(artifact.filename, new Blob([artifact.content], { type: artifact.mimeType }));
  });
  message.appendChild(markdownButton);

  const dirInput = document.createElement('input');
  dirInput.type = 'text';
  dirInput.className = MD_DIR_INPUT_CLASS;
  dirInput.placeholder = labels.saveDirPlaceholder;
  dirInput.title = labels.saveDirInputTitle;
  loadLastMdDir(dirInput);

  const saveDirButton = document.createElement('button');
  saveDirButton.type = 'button';
  saveDirButton.className = MESSAGE_SAVE_DIR_CLASS;
  saveDirButton.textContent = labels.saveDirButton;
  saveDirButton.title = labels.saveDirButtonTitle;
  saveDirButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const targetDir = dirInput.value.trim();
    if (!targetDir) {
      flashSaveDirStatus(saveDirButton, labels.saveDirMissingDir, true, labels.saveDirButton);
      return;
    }
    const baseId = message.dataset.messageId || message.dataset.virtualListItemKey || `dom-${Date.now()}`;
    const dir = targetDir.replace(/[\\/]+$/, '');
    const fileName = `${safeMarkdownFileName(`deepseek-${baseId}`)}.md`;
    const path = `${dir}/${fileName}`;
    const markdownText = getMessageText(message);
    saveDirButton.disabled = true;
    void chrome.runtime.sendMessage({ type: 'WRITE_MARKDOWN_TO_DIR', markdown: markdownText, path })
      .then((response: { ok?: boolean } | undefined) => {
        if (response && response.ok) {
          void chrome.storage.local.set({ [LAST_MD_DIR_STORAGE_KEY]: targetDir });
          flashSaveDirStatus(saveDirButton, labels.saveDirSaved, false, labels.saveDirButton);
        } else {
          fallbackDownloadToBrowser(path, markdownText, downloads);
          flashSaveDirStatus(saveDirButton, labels.saveDirDegraded, false, labels.saveDirButton);
        }
      })
      .catch(() => {
        fallbackDownloadToBrowser(path, markdownText, downloads);
        flashSaveDirStatus(saveDirButton, labels.saveDirDegraded, false, labels.saveDirButton);
      })
      .finally(() => {
        saveDirButton.disabled = false;
      });
  });
  message.appendChild(dirInput);
  message.appendChild(saveDirButton);

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = MESSAGE_COPY_CLASS;
  copyButton.textContent = labels.messageCopyButton;
  copyButton.title = labels.messageCopyTitle;
  copyButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void copyTextToClipboard(getMessageText(message)).catch((error) => {
      console.warn('[DeepSeek++] copy full message output failed:', error);
      showCopyFailure(copyButton, labels, copyFeedbackTimers);
    });
  });
  message.appendChild(copyButton);
}

function showCopyFailure(
  button: HTMLButtonElement,
  labels: ContentUxPolishLabels,
  timers: Set<ReturnType<typeof setTimeout>>,
): void {
  button.dataset.status = 'failed';
  button.textContent = labels.messageCopyFailed;
  const timer = setTimeout(() => {
    timers.delete(timer);
    delete button.dataset.status;
    button.textContent = labels.messageCopyButton;
    button.title = labels.messageCopyTitle;
  }, MESSAGE_COPY_STATUS_MS);
  timers.add(timer);
}

function flashSaveDirStatus(button: HTMLButtonElement, text: string, failed: boolean, resetText: string): void {
  button.dataset.status = failed ? 'failed' : 'ok';
  button.textContent = text;
  const timer = setTimeout(() => {
    delete button.dataset.status;
    button.textContent = resetText;
  }, MESSAGE_COPY_STATUS_MS);
}

function loadLastMdDir(input: HTMLInputElement): void {
  try {
    void chrome.storage.local.get(LAST_MD_DIR_STORAGE_KEY, (result: Record<string, unknown>) => {
      const value = result?.[LAST_MD_DIR_STORAGE_KEY];
      if (typeof value === 'string' && value) input.value = value;
    });
  } catch {
    // Storage API unavailable: leave the input empty so the user types a dir.
  }
}

// Final renderer-side fallback when the background cannot write via Native Host
// and has no `downloads` permission. Mirrors the existing markdown download.
function fallbackDownloadToBrowser(
  path: string,
  markdownText: string,
  downloads: BrowserDownloadManager,
): void {
  const fileName = path.split(/[\\/]/).pop() || 'deepseek-message.md';
  downloads.download(fileName, new Blob([markdownText], { type: 'text/markdown' }));
}

// Sanitize a base name into a filesystem-safe segment (mirrors
// core/export/secondary-artifacts.ts `safeFilename` to avoid a cross-module dep).
function safeMarkdownFileName(value: string): string {
  return value.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'message';
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // writeText rejects when clipboard permission is denied or the document
      // is unfocused; fall through to the legacy path before giving up.
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) {
    throw new Error('Clipboard copy failed.');
  }
}

function applyPolishLabels(root: ParentNode, labels: ContentUxPolishLabels): void {
  root.querySelectorAll<HTMLButtonElement>(`.${CODE_BUTTON_CLASS}`).forEach((button) => {
    button.textContent = labels.codeDownloadButton;
    button.title = labels.codeDownloadButton;
  });
  root.querySelectorAll<HTMLButtonElement>(`.${MESSAGE_BUTTON_CLASS}`).forEach((button) => {
    button.textContent = labels.messageMarkdownButton;
    button.title = labels.messageMarkdownTitle;
  });
  root.querySelectorAll<HTMLButtonElement>(`.${MESSAGE_COPY_CLASS}`).forEach((button) => {
    if (button.dataset.status === 'failed') return;
    button.textContent = labels.messageCopyButton;
    button.title = labels.messageCopyTitle;
  });
}

function getMessageText(message: HTMLElement): string {
  const clone = message.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(`.${MESSAGE_BUTTON_CLASS}, .${MESSAGE_COPY_CLASS}, .${MESSAGE_SAVE_DIR_CLASS}, .${MD_DIR_INPUT_CLASS}`).forEach((node) => node.remove());
  return clone.textContent?.trim() ?? '';
}

function normalizeRole(value: string | undefined): 'user' | 'assistant' | 'system' | 'tool' | 'unknown' {
  if (value === 'user' || value === 'assistant' || value === 'system' || value === 'tool') return value;
  return 'unknown';
}

function getMessageRole(message: HTMLElement): 'user' | 'assistant' | 'system' | 'tool' | 'unknown' {
  const explicit = normalizeRole(message.dataset.messageRole ?? message.dataset.messageAuthorRole);
  if (explicit !== 'unknown') return explicit;
  if (message.querySelector(ASSISTANT_CONTENT_SELECTOR)) return 'assistant';
  if (message.matches('.ds-message, [data-virtual-list-item-key]')) return 'user';
  return 'unknown';
}

function createCandidateMountScheduler(
  getLabels: () => ContentUxPolishLabels,
  copyFeedbackTimers: Set<ReturnType<typeof setTimeout>>,
  downloads: BrowserDownloadManager,
): { schedule(root: ParentNode, codeButtons: Map<HTMLElement, HTMLButtonElement>): void; cancel(): void } {
  const pending = new Set<ParentNode>();
  let pendingCodeButtons: Map<HTMLElement, HTMLButtonElement> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    schedule(root: ParentNode, codeButtons: Map<HTMLElement, HTMLButtonElement>): void {
      pending.add(root);
      pendingCodeButtons = codeButtons;
      if (timer) return;

      timer = setTimeout(() => {
        timer = null;
        const roots = Array.from(pending);
        pending.clear();
        const labels = getLabels();
        for (const candidate of roots) {
          if (pendingCodeButtons) {
            mountPolish(candidate, labels, pendingCodeButtons, copyFeedbackTimers, downloads);
          }
        }
        pendingCodeButtons = null;
      }, POLISH_MOUNT_DELAY_MS);
    },
    cancel(): void {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pending.clear();
      pendingCodeButtons = null;
    },
  };
}

function collectPolishCandidateRoots(mutations: readonly MutationRecord[]): ParentNode[] {
  const roots = new Set<ParentNode>();

  for (const mutation of mutations) {
    for (const node of Array.from(mutation.addedNodes)) {
      const root = getPolishCandidateRoot(node);
      if (root) roots.add(root);
    }
  }

  return Array.from(roots);
}

function getPolishCandidateRoot(node: Node): ParentNode | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement;
    return parent?.closest(`pre, ${MESSAGE_SELECTOR}`) ?? null;
  }

  if (!(node instanceof Element)) return null;
  if (node.matches(`pre, ${MESSAGE_SELECTOR}`)) return node;
  if (node.querySelector(`pre, ${MESSAGE_SELECTOR}`)) return node;
  return null;
}

function queryIncludingRoot<T extends HTMLElement>(root: ParentNode, selector: string): T[] {
  const matches: T[] = [];
  if (root instanceof Element && root.matches(selector)) {
    matches.push(root as T);
  }
  matches.push(...Array.from(root.querySelectorAll<T>(selector)));
  return matches;
}

function syncCodeButtonPositions(codeButtons: Map<HTMLElement, HTMLButtonElement>): void {
  for (const [pre, button] of codeButtons) {
    if (!pre.isConnected) {
      button.remove();
      codeButtons.delete(pre);
      continue;
    }
    positionCodeButton(pre, button);
  }
}

function positionCodeButton(pre: HTMLElement, button: HTMLButtonElement): void {
  const rect = pre.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const hidden = rect.bottom < 0 || rect.top > viewportHeight || rect.right < 0 || rect.left > viewportWidth;
  const maxLeft = Math.max(CODE_BUTTON_OFFSET_PX, viewportWidth - CODE_BUTTON_OFFSET_PX);
  const maxTop = Math.max(CODE_BUTTON_OFFSET_PX, viewportHeight - CODE_BUTTON_OFFSET_PX);
  button.style.display = hidden ? 'none' : '';
  button.style.top = `${Math.min(maxTop, Math.max(CODE_BUTTON_OFFSET_PX, rect.top + CODE_BUTTON_OFFSET_PX))}px`;
  button.style.left = `${Math.min(maxLeft, Math.max(CODE_BUTTON_OFFSET_PX, rect.right - CODE_BUTTON_OFFSET_PX))}px`;
}

function extensionForLanguage(language: string): string {
  const normalized = language.toLowerCase();
  if (normalized === 'javascript' || normalized === 'js' || normalized === 'jsx') return 'js';
  if (normalized === 'typescript' || normalized === 'ts' || normalized === 'tsx') return 'ts';
  if (normalized === 'python' || normalized === 'py') return 'py';
  if (normalized === 'json') return 'json';
  if (normalized === 'bash' || normalized === 'shell' || normalized === 'sh') return 'sh';
  if (normalized === 'markdown' || normalized === 'md') return 'md';
  return 'txt';
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .${CODE_BUTTON_CLASS}, .${MESSAGE_BUTTON_CLASS}, .${MESSAGE_COPY_CLASS} {
      border: 1px solid rgba(0, 0, 0, 0.12);
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.92);
      color: #334155;
      font: 11px/1.2 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
      cursor: pointer;
    }
    .${CODE_BUTTON_CLASS} {
      position: fixed;
      transform: translateX(-100%);
      z-index: 2147483647;
      padding: 4px 7px;
    }
    .${MESSAGE_BUTTON_CLASS}, .${MESSAGE_COPY_CLASS} {
      float: right;
      margin: 0 0 6px 8px;
      padding: 3px 6px;
    }
    .${MD_DIR_INPUT_CLASS} {
      float: right;
      margin: 0 0 6px 8px;
      padding: 3px 6px;
      width: 150px;
      font: 11px/1.2 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
      border: 1px solid rgba(0, 0, 0, 0.12);
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.92);
      color: #334155;
    }
    .${MESSAGE_SAVE_DIR_CLASS} {
      float: right;
      margin: 0 0 6px 8px;
      padding: 3px 6px;
      border: 1px solid rgba(0, 0, 0, 0.12);
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.92);
      color: #334155;
      font: 11px/1.2 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
      cursor: pointer;
    }
    .${MESSAGE_SAVE_DIR_CLASS}[data-status="failed"] {
      border-color: rgba(220, 38, 38, 0.55);
      color: #b91c1c;
    }
    .${MESSAGE_COPY_CLASS}[data-status="failed"] {
      border-color: rgba(220, 38, 38, 0.55);
      color: #b91c1c;
    }
  `;
  document.head.appendChild(style);
}
