import {
  installFetchHook,
  updateHookState,
  type RequestBodyModification,
  type ResponseCompletePayload,
  type ResponseTokenSpeedPayload,
} from '../core/interceptor/fetch-hook';
import { initSkillPopup } from '../core/ui/skill-popup';
import type {
  ToolCall,
  ToolCallRestoreRecord,
  ToolDescriptor,
} from '../core/types';
import type { SkillPopupItem } from '../core/ui/skill-popup';

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
};

let contentPort: MessagePort | null = null;
let bridgeRequestAttempts = 0;
let bridgeRequestTimer: ReturnType<typeof setInterval> | null = null;
const pendingAugmentRequests = new Map<string, PendingRequest<RequestBodyModification | null>>();

export default defineContentScript({
  matches: ['*://chat.deepseek.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    installContentBridge();
    installFetchHook();

    updateHookState({
      onRequestBody: requestAugmentedBody,
      onHeadersCaptured(headers: Record<string, string> | null) {
        postToContent({ type: 'HEADERS_CAPTURED', headers });
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
  },
});

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
  const message = data && typeof data === 'object' ? data as AugmentResultMessage : {};
  if (message.source !== CONTENT_SOURCE) return;

  switch (message.type) {
    case 'SYNC_HOOK_STATE': {
      const value = message as { toolDescriptors?: unknown; skillSummaries?: unknown };
      updateHookState({
        toolDescriptors: normalizeToolDescriptors(value.toolDescriptors),
      });
      initSkillPopup(normalizeSkillSummaries(value.skillSummaries));
      break;
    }
    case 'AUGMENT_REQUEST_BODY_RESULT': {
      settleAugmentRequest(message);
      break;
    }
  }
}

function requestAugmentedBody(body: string): Promise<RequestBodyModification | null> {
  if (!contentPort) {
    throw new Error('DeepSeek++ main/content bridge is not connected.');
  }

  const id = crypto.randomUUID();
  return new Promise<RequestBodyModification | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingAugmentRequests.delete(id);
      reject(new Error('DeepSeek++ request augmentation timed out.'));
    }, REQUEST_TIMEOUT_MS);

    pendingAugmentRequests.set(id, { resolve, reject, timeout });
    postToContent({ type: 'AUGMENT_REQUEST_BODY', id, body });
  });
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
