import type { RequestBodyModification } from '../../../core/interceptor/fetch-hook';
import {
  BRIDGE_HANDSHAKE_TYPES,
  BRIDGE_READY_TYPE,
  BRIDGE_SOURCES,
  createBridgeSessionController,
  isBridgeHandshakeMessage,
  validateBridgeMessage,
  type BridgeSessionContext,
} from '../../../core/messaging/schema';
import {
  MULTIMODAL_REQUEST_AUGMENTATION_MAX_TIMEOUT_MS,
  MULTIMODAL_REQUEST_AUGMENTATION_TIMEOUT_MS,
} from '../../../core/multimodal';
import type { ToolDescriptor } from '../../../core/types';
import type { SkillPopupCopy, SkillPopupItem } from '../../../core/ui/skill-popup';
import type {
  ContentCapabilityController,
  ContentLifecycleStopReason,
  ContentResourceRelease,
  ContentResourceScope,
} from '../lifecycle';

export interface MainWorldBridgeController extends ContentCapabilityController {
  post(message: Record<string, unknown>): void;
  requestAugmentedBody(body: string, requestId: string): Promise<RequestBodyModification | null>;
}

export interface MainWorldBridgeState {
  toolDescriptors: ToolDescriptor[];
  skillSummaries: SkillPopupItem[];
  skillPopupCopy: Partial<SkillPopupCopy>;
}

export interface MainWorldBridgeControllerDependencies {
  readonly target?: Window;
  readonly createSessionId?: () => string;
  readonly applyState: (state: MainWorldBridgeState) => void;
  readonly clearState: () => void;
  readonly reportError: (message: string, error?: unknown) => void;
}

type PendingRequest = {
  resolve: (value: RequestBodyModification | null) => void;
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

const MAIN_WORLD_SOURCE = BRIDGE_SOURCES.mainWorld;
const CONTENT_SOURCE = BRIDGE_SOURCES.content;
const BRIDGE_REQUEST_TYPE = BRIDGE_HANDSHAKE_TYPES.request;
const BRIDGE_INIT_TYPE = BRIDGE_HANDSHAKE_TYPES.init;
const BRIDGE_DISCONNECT_TYPE = BRIDGE_HANDSHAKE_TYPES.disconnect;
const REQUEST_TIMEOUT_MS = 8_000;
const BRIDGE_REQUEST_INTERVAL_MS = 50;
const BRIDGE_REQUEST_MAX_ATTEMPTS = 100;

export function createMainWorldBridgeController(
  dependencies: MainWorldBridgeControllerDependencies,
): MainWorldBridgeController {
  const target = dependencies.target ?? window;
  const createSessionId = dependencies.createSessionId ?? (() => crypto.randomUUID());
  let scope: ContentResourceScope | null = null;
  let port: MessagePort | null = null;
  let releasePort: ContentResourceRelease | null = null;
  let bridgeSession: BridgeSessionContext | null = null;
  let bridgeSessions: ReturnType<typeof createBridgeSessionController> | null = null;
  let bridgeRequestAttempts = 0;
  let bridgeRequestTimer: ReturnType<typeof setInterval> | null = null;
  const pendingRequests = new Map<string, PendingRequest>();

  const stopBridgeRequests = () => {
    if (!scope || bridgeRequestTimer === null) return;
    scope.clearInterval(bridgeRequestTimer);
    bridgeRequestTimer = null;
  };

  const disconnectBridge = async () => {
    const currentPort = port;
    const currentRelease = releasePort;
    const session = bridgeSession;
    port = null;
    releasePort = null;
    bridgeSession = null;
    bridgeSessions?.close(session ?? undefined);
    if (currentPort) {
      currentPort.onmessage = null;
      currentPort.onmessageerror = null;
    }
    dependencies.clearState();
    for (const pending of pendingRequests.values()) {
      scope?.clearTimeout(pending.timeout);
      pending.reject(new Error('DeepSeek++ main/content bridge disconnected.'));
    }
    pendingRequests.clear();
    await currentRelease?.();
  };

  const startBridgeRequests = () => {
    if (!scope?.active || bridgeRequestTimer !== null || port) return;
    bridgeRequestAttempts = 0;
    bridgeRequestTimer = scope.setInterval(() => {
      if (port || bridgeRequestAttempts >= BRIDGE_REQUEST_MAX_ATTEMPTS) {
        stopBridgeRequests();
        return;
      }
      bridgeRequestAttempts += 1;
      target.postMessage(
        { source: MAIN_WORLD_SOURCE, type: BRIDGE_REQUEST_TYPE },
        target.location.origin,
      );
    }, BRIDGE_REQUEST_INTERVAL_MS);
  };

  const post = (message: Record<string, unknown>) => {
    if (!scope?.active || !port) return;
    port.postMessage({ source: MAIN_WORLD_SOURCE, ...message });
  };

  const extendRequestTimeout = (message: AugmentResultMessage) => {
    if (!scope || !message.id) return;
    const pending = pendingRequests.get(message.id);
    if (!pending) return;
    scope.clearTimeout(pending.timeout);
    const timeoutMs = Math.max(
      REQUEST_TIMEOUT_MS,
      Math.min(
        message.timeoutMs ?? MULTIMODAL_REQUEST_AUGMENTATION_TIMEOUT_MS,
        MULTIMODAL_REQUEST_AUGMENTATION_MAX_TIMEOUT_MS,
      ),
    );
    pending.timeout = scope.setTimeout(() => {
      pendingRequests.delete(message.id!);
      pending.reject(new Error('DeepSeek++ request augmentation timed out.'));
    }, timeoutMs);
  };

  const settleRequest = (message: AugmentResultMessage) => {
    if (!scope || !message.id) return;
    const pending = pendingRequests.get(message.id);
    if (!pending) return;
    pendingRequests.delete(message.id);
    scope.clearTimeout(pending.timeout);
    if (message.ok === false) {
      const error = message.error || 'DeepSeek++ request augmentation failed.';
      if (isExtensionUnavailableMessage(error)) pending.resolve(null);
      else pending.reject(new Error(error));
      return;
    }
    pending.resolve(message.result ?? null);
  };

  const handlePortMessage = (data: unknown, session: BridgeSessionContext) => {
    if (
      !scope?.active
      || !bridgeSessions?.accepts(session, target.location.origin, target === target.top)
    ) return;
    const validated = validateBridgeMessage(data, CONTENT_SOURCE);
    if (!validated) return;
    const message = validated as AugmentResultMessage;
    switch (message.type) {
      case 'SYNC_HOOK_STATE': {
        const state = message as AugmentResultMessage & {
          toolDescriptors?: unknown;
          skillSummaries?: unknown;
          skillPopupCopy?: unknown;
        };
        dependencies.applyState({
          toolDescriptors: normalizeToolDescriptors(state.toolDescriptors),
          skillSummaries: normalizeSkillSummaries(state.skillSummaries),
          skillPopupCopy: normalizeSkillPopupCopy(state.skillPopupCopy),
        });
        break;
      }
      case 'AUGMENT_REQUEST_BODY_RESULT':
        settleRequest(message);
        break;
      case 'AUGMENT_REQUEST_BODY_EXTEND_TIMEOUT':
        extendRequestTimeout(message);
        break;
    }
  };

  const handlePortMessageError = (session: BridgeSessionContext) => {
    if (
      !scope?.active
      || !bridgeSessions?.accepts(session, target.location.origin, target === target.top)
    ) return;
    dependencies.reportError('[DeepSeek++] content bridge message could not be decoded; requesting state resync');
    dependencies.clearState();
    post({ type: 'SYNC_HOOK_STATE_REQUEST' });
  };

  const handleHandshake = (event: Event) => {
    if (!scope?.active) return;
    const messageEvent = event as MessageEvent;
    if (port && isBridgeHandshakeMessage({
      value: messageEvent.data,
      actualOrigin: messageEvent.origin,
      expectedOrigin: target.location.origin,
      expectedSource: CONTENT_SOURCE,
      expectedType: BRIDGE_DISCONNECT_TYPE,
      alreadyConnected: true,
      allowWhileConnected: true,
      actualWindowSource: messageEvent.source,
      expectedWindowSource: target,
      actualTopLevel: target === target.top,
      requireTopLevel: true,
      forbidTransferredPorts: true,
      transferredPortCount: messageEvent.ports.length,
    })) {
      const disconnect = disconnectBridge();
      startBridgeRequests();
      void disconnect.catch((error) => {
        dependencies.reportError('[DeepSeek++] content bridge disconnect failed', error);
      });
      return;
    }
    if (!isBridgeHandshakeMessage({
      value: messageEvent.data,
      actualOrigin: messageEvent.origin,
      expectedOrigin: target.location.origin,
      expectedSource: CONTENT_SOURCE,
      expectedType: BRIDGE_INIT_TYPE,
      alreadyConnected: Boolean(port),
      actualWindowSource: messageEvent.source,
      expectedWindowSource: target,
      actualTopLevel: target === target.top,
      requireTopLevel: true,
      requireTransferredPort: true,
      transferredPortCount: messageEvent.ports.length,
    })) return;

    const [transferredPort] = messageEvent.ports;
    const session = bridgeSessions?.open(
      createSessionId(),
      target.location.origin,
      target === target.top,
    );
    if (!session) return;
    bridgeSession = session;
    port = transferredPort;
    releasePort = scope.addCleanup('message-port', () => transferredPort.close());
    port.onmessage = (message) => handlePortMessage(message.data, session);
    port.onmessageerror = () => handlePortMessageError(session);
    port.start();
    stopBridgeRequests();
    post({ type: BRIDGE_READY_TYPE });
    post({ type: 'NAVIGATION_CHANGED' });
  };

  const requestAugmentedBody = (
    body: string,
    requestId: string,
  ): Promise<RequestBodyModification | null> => {
    if (!scope?.active || !port) return Promise.resolve(null);
    const id = createSessionId();
    return new Promise<RequestBodyModification | null>((resolve, reject) => {
      const timeout = scope!.setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error('DeepSeek++ request augmentation timed out.'));
      }, REQUEST_TIMEOUT_MS);
      pendingRequests.set(id, { resolve, reject, timeout });
      post({ type: 'AUGMENT_REQUEST_BODY', id, requestId, body });
    });
  };

  const stop = async (_reason: ContentLifecycleStopReason) => {
    stopBridgeRequests();
    if (port) {
      target.postMessage(
        { source: MAIN_WORLD_SOURCE, type: BRIDGE_DISCONNECT_TYPE },
        target.location.origin,
      );
    }
    await disconnectBridge();
    bridgeSessions = null;
    scope = null;
  };

  return {
    id: 'content-bridge',
    post,
    requestAugmentedBody,
    start(nextScope) {
      scope = nextScope;
      bridgeSessions = createBridgeSessionController(target.location.origin);
      nextScope.listen(target, 'message', handleHandshake);
      startBridgeRequests();
    },
    stop,
  };
}

function isExtensionUnavailableMessage(message: string): boolean {
  return message.includes('Extension context invalidated')
    || message.includes('context invalidated')
    || message.includes('Extension context is unavailable')
    || message.includes('main/content bridge is not connected');
}

function normalizeToolDescriptors(value: unknown): ToolDescriptor[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ToolDescriptor => Boolean(item && typeof item === 'object'));
}

function normalizeSkillSummaries(value: unknown): SkillPopupItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is { name: string; description: string } => (
      Boolean(item && typeof item === 'object')
      && typeof (item as { name?: unknown }).name === 'string'
      && typeof (item as { description?: unknown }).description === 'string'
    ))
    .map((item) => ({ name: item.name, description: item.description }));
}

function normalizeSkillPopupCopy(value: unknown): Partial<SkillPopupCopy> {
  if (!value || typeof value !== 'object') return {};
  const hint = (value as { hint?: unknown }).hint;
  return typeof hint === 'string' && hint.trim() ? { hint } : {};
}
