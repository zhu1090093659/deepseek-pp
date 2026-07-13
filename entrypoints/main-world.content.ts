import {
  installFetchHook,
  updateHookState,
  type RequestBodyModification,
  type RequestTerminalPayload,
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
import type { ToolCallPayloadChunk } from '../core/interceptor/streaming-tool-call-parser';
import type { SkillPopupCopy, SkillPopupItem } from '../core/ui/skill-popup';
import {
  BRIDGE_HANDSHAKE_TYPES,
  BRIDGE_READY_TYPE,
  BRIDGE_SOURCES,
  createBridgeSessionController,
  isBridgeHandshakeMessage,
  validateBridgeMessage,
  type BridgeSessionController,
  type BridgeSessionContext,
} from '../core/messaging/schema';

const MAIN_WORLD_SOURCE = BRIDGE_SOURCES.mainWorld;
const CONTENT_SOURCE = BRIDGE_SOURCES.content;
const BRIDGE_REQUEST_TYPE = BRIDGE_HANDSHAKE_TYPES.request;
const BRIDGE_INIT_TYPE = BRIDGE_HANDSHAKE_TYPES.init;
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
let contentBridgeSessions: BridgeSessionController | null = null;
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
      onToolCallStarted(call: ToolCall) {
        postToContent({ type: 'TOOL_CALL_STARTED', data: call });
      },
      onToolCall(call: ToolCall) {
        postToContent({ type: 'TOOL_CALL', data: call });
      },
      onToolCallChunk(chunk: ToolCallPayloadChunk) {
        postToContent({ type: 'TOOL_CALL_CHUNK', data: chunk });
      },
      onToolCallsRestored(records: ToolCallRestoreRecord[]) {
        postToContent({ type: 'RESTORE_TOOL_CALLS', records });
      },
      onResponseComplete(complete: ResponseCompletePayload) {
        postToContent({ type: 'RESPONSE_COMPLETE', payload: complete });
      },
      onRequestTerminal(terminal: RequestTerminalPayload) {
        postToContent({ type: 'REQUEST_TERMINAL', payload: terminal });
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
  contentBridgeSessions = createBridgeSessionController(window.location.origin);
  window.addEventListener('pagehide', () => disconnectContentPort());
  window.addEventListener('pageshow', (event) => {
    if (event.persisted && !contentPort) startBridgeRequests();
  });
  window.addEventListener('message', (event) => {
    if (!isBridgeHandshakeMessage({
      value: event.data,
      actualOrigin: event.origin,
      expectedOrigin: window.location.origin,
      expectedSource: CONTENT_SOURCE,
      expectedType: BRIDGE_INIT_TYPE,
      alreadyConnected: Boolean(contentPort),
      actualWindowSource: event.source,
      expectedWindowSource: window,
      actualTopLevel: window === window.top,
      requireTopLevel: true,
      requireTransferredPort: true,
      transferredPortCount: event.ports.length,
    })) return;

    const [port] = event.ports;
    const bridgeSession = contentBridgeSessions?.open(
      crypto.randomUUID(),
      window.location.origin,
      window === window.top,
    );
    if (!bridgeSession) return;

    contentPort = port;
    contentPort.onmessage = (message) => handlePortMessage(message.data, bridgeSession);
    contentPort.onmessageerror = () => disconnectContentPort(bridgeSession);
    contentPort.start();
    stopBridgeRequests();
    postToContent({ type: BRIDGE_READY_TYPE });
  });

  startBridgeRequests();
}

function startBridgeRequests(): void {
  if (bridgeRequestTimer || contentPort) return;
  bridgeRequestAttempts = 0;
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

function handlePortMessage(data: unknown, bridgeSession: BridgeSessionContext): void {
  if (!contentBridgeSessions?.accepts(
    bridgeSession,
    window.location.origin,
    window === window.top,
  )) return;

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

function disconnectContentPort(bridgeSession?: BridgeSessionContext): void {
  if (!contentBridgeSessions?.close(bridgeSession)) return;
  contentPort?.close();
  contentPort = null;
  stopBridgeRequests();

  for (const pending of pendingAugmentRequests.values()) {
    clearTimeout(pending.timeout);
    pending.reject(new Error('DeepSeek++ main/content bridge disconnected.'));
  }
  pendingAugmentRequests.clear();
}

function requestAugmentedBody(
  body: string,
  requestId: string,
): Promise<RequestBodyModification | null> {
  if (!contentPort) {
    return Promise.resolve(null);
  }

  const id = crypto.randomUUID();
  return new Promise<RequestBodyModification | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingAugmentRequests.delete(id);
      reject(new Error('DeepSeek++ request augmentation timed out.'));
    }, REQUEST_TIMEOUT_MS);

    pendingAugmentRequests.set(id, { resolve, reject, timeout });
    postToContent({ type: 'AUGMENT_REQUEST_BODY', id, requestId, body });
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
    const error = message.error || 'DeepSeek++ request augmentation failed.';
    if (isExtensionUnavailableMessage(error)) {
      pending.resolve(null);
    } else {
      pending.reject(new Error(error));
    }
    return;
  }

  pending.resolve(message.result ?? null);
}

function isExtensionUnavailableMessage(message: string): boolean {
  return message.includes('Extension context invalidated') ||
    message.includes('context invalidated') ||
    message.includes('Extension context is unavailable') ||
    message.includes('main/content bridge is not connected');
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

function normalizeSkillPopupCopy(value: unknown): Partial<SkillPopupCopy> {
  if (!value || typeof value !== 'object') return {};
  const hint = (value as { hint?: unknown }).hint;
  return typeof hint === 'string' && hint.trim() ? { hint } : {};
}
