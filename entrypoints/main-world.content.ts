import {
  installFetchHook,
  updateHookState,
  type RequestBodyModification,
  type ResponseCompletePayload,
  type ResponseTokenSpeedPayload,
} from '../core/interceptor/fetch-hook';
import {
  MULTIMODAL_REQUEST_AUGMENTATION_MAX_TIMEOUT_MS,
  MULTIMODAL_REQUEST_AUGMENTATION_TIMEOUT_MS,
} from '../core/multimodal';
import { initSkillPopup } from '../core/ui/skill-popup';
import type {
  ToolCall,
  ToolCallRestoreRecord,
  ToolDescriptor,
} from '../core/types';
import type { SkillPopupCopy, SkillPopupItem } from '../core/ui/skill-popup';
import { validateBridgeMessage } from '../core/messaging/schema';

const MAIN_WORLD_SOURCE = 'deepseek-pp-main';
const CONTENT_SOURCE = 'deepseek-pp-content';
const BRIDGE_REQUEST_TYPE = 'DPP_BRIDGE_REQUEST';
const BRIDGE_INIT_TYPE = 'DPP_BRIDGE_INIT';
const BRIDGE_READY_TYPE = 'DPP_BRIDGE_READY';
const REQUEST_TIMEOUT_MS = 8_000;
const BRIDGE_REQUEST_INTERVAL_MS = 50;
const BRIDGE_REQUEST_MAX_ATTEMPTS = 100;

type PendingRequest<T> = {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type AugmentResultMessage = {
  source?: string;
  type?: string;
  id?: string;
  ok?: boolean;
  result?: RequestBodyModification | null;
  error?: string;
  timeoutMs?: number;
};

let contentPort: MessagePort | null = null;
let bridgeRequestAttempts = 0;
let bridgeRequestTimer: ReturnType<typeof setInterval> | null = null;
const pendingAugmentRequests = new Map<string, PendingRequest<RequestBodyModification | null>>();

// Desktop: both main-world.js and content.js run in the MAIN world and
// communicate through the contextBridge-exposed DPP_BRIDGE proxy (IPC-relay
// through the main process) instead of MessagePort / window.postMessage.
const isDesktop = typeof window !== 'undefined' && !!(window as any).__DPP_DESKTOP__;

// Desktop: the page-facing DPP_BRIDGE is token-gated (Blocker 2). The token is
// injected by the preload as a closure variable around this whole bundle and is
// NOT a global, so other main-world (page) scripts cannot read it. Every bridge
// call must present it. In the extension build the closure variable is absent,
// so getBridgeToken() resolves to '' and the desktop bridge is never used.
declare const __DPP_BRIDGE_TOKEN__: string | undefined;
function getBridgeToken(): string {
  try {
    return typeof __DPP_BRIDGE_TOKEN__ === 'string' ? __DPP_BRIDGE_TOKEN__ : '';
  } catch {
    return '';
  }
}

interface DppBridge {
  sendMessage(token: string, message: Record<string, unknown>): Promise<unknown>;
  onMessage: {
    addListener(token: string, fn: (message: any, sender: any, sendResponse: (r: any) => void) => void): void;
    removeListener(token: string, fn: (message: any, sender: any, sendResponse: (r: any) => void) => void): void;
  };
}

function getDesktopBridge(): DppBridge | null {
  return isDesktop ? ((window as any).DPP_BRIDGE as DppBridge) ?? null : null;
}

export default defineContentScript({
  matches: ['*://chat.deepseek.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main,
});

// Desktop injects main-world.js directly via webFrame.executeJavaScript
// without the WXT content-script runtime that normally calls main().
// Auto-run here with a guard so it also works on desktop, while the
// guard prevents double-execution when the WXT runtime calls it in
// the browser extension build.
if (typeof window !== 'undefined' && (window as any).__DPP_DESKTOP__ && !(window as any).__DPP_MAIN_WORLD_INITIALIZED__) {
  main();
}

function main(): void {
  if ((window as any).__DPP_MAIN_WORLD_INITIALIZED__) return;
  (window as any).__DPP_MAIN_WORLD_INITIALIZED__ = true;

  if (isDesktop) {
    // Desktop: listen for content.js responses via DPP_BRIDGE (IPC relay).
    const bridge = getDesktopBridge();
    bridge?.onMessage.addListener(getBridgeToken(), (message: AugmentResultMessage) => {
      handleBridgeResponse(message);
    });
  } else {
    // Extension: MessagePort handshake (browser-only path).
    installContentBridge();
  }

  installFetchHook();

  updateHookState({
    onRequestBody: requestAugmentedBody,
    onHeadersCaptured(headers: Record<string, string> | null) {
      // Desktop captures auth headers in the main process; skip bridge send.
      if (!isDesktop) postToContent({ type: 'HEADERS_CAPTURED', headers });
    },
    onToolCallStarted(call: ToolCall) {
      postToContent({ type: 'TOOL_CALL_STARTED', data: call });
    },
    onToolCall(call: ToolCall) {
      postToContent({ type: 'TOOL_CALL', data: call });
    },
    onToolCallsRestored(records: ToolCallRestoreRecord[]) {
      postToContent({ type: 'RESTORE_TOOL_CALLS', records });
    },
    onResponseComplete(complete: ResponseCompletePayload) {
      postToContent({ type: 'RESPONSE_COMPLETE', payload: complete });
    },
    onResponseTokenSpeed(progress: ResponseTokenSpeedPayload) {
      postToContent({ type: 'RESPONSE_TOKEN_SPEED', payload: progress });
    },
    onMemoriesUsed(ids: number[]) {
      postToContent({ type: 'MEMORIES_USED', ids });
    },
  });
}

function installContentBridge(): void {
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.source !== CONTENT_SOURCE || event.data.type !== BRIDGE_INIT_TYPE) return;
    if (contentPort) return;

    const [port] = event.ports;
    if (!port) return;

    contentPort = port;
    contentPort.onmessage = (message) => handlePortMessage(message.data);
    contentPort.start();
    stopBridgeRequests();
    postToContent({ type: BRIDGE_READY_TYPE });
  });

  bridgeRequestTimer = setInterval(() => {
    if (contentPort || bridgeRequestAttempts >= BRIDGE_REQUEST_MAX_ATTEMPTS) {
      stopBridgeRequests();
      return;
    }
    bridgeRequestAttempts++;
    window.postMessage({ source: MAIN_WORLD_SOURCE, type: BRIDGE_REQUEST_TYPE }, window.location.origin);
  }, BRIDGE_REQUEST_INTERVAL_MS);
}

function stopBridgeRequests(): void {
  if (!bridgeRequestTimer) return;
  clearInterval(bridgeRequestTimer);
  bridgeRequestTimer = null;
}

function handlePortMessage(data: unknown): void {
  const validated = validateBridgeMessage(data, CONTENT_SOURCE);
  if (!validated) return;
  const message = validated as AugmentResultMessage;
  if (message.source !== CONTENT_SOURCE) return;

  switch (message.type) {
    case 'SYNC_HOOK_STATE': {
      const value = message as { toolDescriptors?: unknown; skillSummaries?: unknown; skillPopupCopy?: unknown };
      updateHookState({
        toolDescriptors: normalizeToolDescriptors(value.toolDescriptors),
      });
      initSkillPopup(normalizeSkillSummaries(value.skillSummaries), normalizeSkillPopupCopy(value.skillPopupCopy));
      break;
    }
    case 'AUGMENT_REQUEST_BODY_RESULT': {
      settleAugmentRequest(message);
      break;
    }
    case 'AUGMENT_REQUEST_BODY_EXTEND_TIMEOUT': {
      extendAugmentRequestTimeout(message);
      break;
    }
  }
}

// Desktop: handles messages from content.js received via DPP_BRIDGE.onMessage.
// IPC relay is trusted (no source validation needed — the main process
// already validated the sender is the chat window's preload).
function handleBridgeResponse(message: AugmentResultMessage): void {
  switch (message.type) {
    case 'SYNC_HOOK_STATE': {
      const value = message as { toolDescriptors?: unknown; skillSummaries?: unknown; skillPopupCopy?: unknown };
      updateHookState({
        toolDescriptors: normalizeToolDescriptors(value.toolDescriptors),
      });
      initSkillPopup(normalizeSkillSummaries(value.skillSummaries), normalizeSkillPopupCopy(value.skillPopupCopy));
      break;
    }
    case 'AUGMENT_REQUEST_BODY_RESULT': {
      settleAugmentRequest(message);
      break;
    }
    case 'AUGMENT_REQUEST_BODY_EXTEND_TIMEOUT': {
      extendAugmentRequestTimeout(message);
      break;
    }
  }
}

function requestAugmentedBody(body: string): Promise<RequestBodyModification | null> {
  const bridge = getDesktopBridge();
  if (!bridge && !contentPort) {
    throw new Error('DeepSeek++ main/content bridge is not connected.');
  }

  const id = crypto.randomUUID();
  return new Promise<RequestBodyModification | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingAugmentRequests.delete(id);
      reject(new Error('DeepSeek++ request augmentation timed out.'));
    }, REQUEST_TIMEOUT_MS);

    pendingAugmentRequests.set(id, { resolve, reject, timeout });

    if (bridge) {
      // Desktop: send through IPC relay (response arrives via DPP_BRIDGE.onMessage)
      bridge.sendMessage(getBridgeToken(), { type: 'AUGMENT_REQUEST_BODY', id, body }).catch(() => {});
    } else {
      postToContent({ type: 'AUGMENT_REQUEST_BODY', id, body });
    }
  });
}

function extendAugmentRequestTimeout(message: AugmentResultMessage): void {
  const id = message.id;
  if (!id) return;
  const pending = pendingAugmentRequests.get(id);
  if (!pending) return;

  clearTimeout(pending.timeout);
  const timeoutMs = Math.max(
    REQUEST_TIMEOUT_MS,
    Math.min(
      message.timeoutMs ?? MULTIMODAL_REQUEST_AUGMENTATION_TIMEOUT_MS,
      MULTIMODAL_REQUEST_AUGMENTATION_MAX_TIMEOUT_MS,
    ),
  );
  pending.timeout = setTimeout(() => {
    pendingAugmentRequests.delete(id);
    pending.reject(new Error('DeepSeek++ request augmentation timed out.'));
  }, timeoutMs);
}

function settleAugmentRequest(message: AugmentResultMessage): void {
  if (!message.id) return;
  const pending = pendingAugmentRequests.get(message.id);
  if (!pending) return;

  pendingAugmentRequests.delete(message.id);
  clearTimeout(pending.timeout);

  if (message.ok === false) {
    pending.reject(new Error(message.error || 'DeepSeek++ request augmentation failed.'));
    return;
  }

  pending.resolve(message.result ?? null);
}

function postToContent(message: Record<string, unknown>): void {
  if (isDesktop) {
    // Desktop: send through DPP_BRIDGE IPC relay to content.js
    const bridge = getDesktopBridge();
    bridge?.sendMessage(getBridgeToken(), message).catch(() => {});
    return;
  }
  if (!contentPort) return;
  contentPort.postMessage({ source: MAIN_WORLD_SOURCE, ...message });
}

function normalizeToolDescriptors(value: unknown): ToolDescriptor[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ToolDescriptor => Boolean(item && typeof item === 'object'));
}

function normalizeSkillSummaries(value: unknown): SkillPopupItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is { name: string; description: string } =>
      Boolean(item && typeof item === 'object') &&
      typeof (item as { name?: unknown }).name === 'string' &&
      typeof (item as { description?: unknown }).description === 'string',
    )
    .map((item) => ({ name: item.name, description: item.description }));
}

function normalizeSkillPopupCopy(value: unknown): Partial<SkillPopupCopy> {
  if (!value || typeof value !== 'object') return {};
  const hint = (value as { hint?: unknown }).hint;
  return typeof hint === 'string' && hint.trim() ? { hint } : {};
}
