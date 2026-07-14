import {
  BRIDGE_HANDSHAKE_TYPES,
  BRIDGE_READY_TYPE,
  BRIDGE_SOURCES,
  createBridgeSessionController,
  isBridgeHandshakeMessage,
  validateBridgeMessage,
  type BridgeSessionContext,
} from '../../../core/messaging/schema';
import type {
  ContentCapabilityController,
  ContentLifecycleStopReason,
  ContentResourceScope,
} from '../lifecycle';

export interface IsolatedBridgeController extends ContentCapabilityController {
  post(message: Record<string, unknown>): void;
  readonly ready: boolean;
}

export interface IsolatedBridgeControllerDependencies {
  readonly target?: Window;
  readonly createMessageChannel?: () => MessageChannel;
  readonly createSessionId?: () => string;
  readonly handleAugmentRequestBody: (message: {
    id?: unknown;
    requestId?: unknown;
    body?: unknown;
  }) => Promise<void>;
  readonly handleMainWorldMessage: (message: Record<string, unknown>) => void | Promise<void>;
  readonly syncRuntimeState: () => void;
  readonly disconnectRuntimeState: () => void | Promise<void>;
  readonly reportError: (message: string, error?: unknown) => void;
}

const MAIN_WORLD_SOURCE = BRIDGE_SOURCES.mainWorld;
const CONTENT_SOURCE = BRIDGE_SOURCES.content;
const BRIDGE_REQUEST_TYPE = BRIDGE_HANDSHAKE_TYPES.request;
const BRIDGE_INIT_TYPE = BRIDGE_HANDSHAKE_TYPES.init;

export function createIsolatedBridgeController(
  dependencies: IsolatedBridgeControllerDependencies,
): IsolatedBridgeController {
  const target = dependencies.target ?? window;
  const createMessageChannel = dependencies.createMessageChannel ?? (() => new MessageChannel());
  const createSessionId = dependencies.createSessionId ?? (() => crypto.randomUUID());
  let scope: ContentResourceScope | null = null;
  let port: MessagePort | null = null;
  let ready = false;
  let bridgeSession: BridgeSessionContext | null = null;
  let bridgeSessions: ReturnType<typeof createBridgeSessionController> | null = null;
  let lifecycleState: 'created' | 'running' | 'stopped' = 'created';
  const pendingMessages: Record<string, unknown>[] = [];
  const pendingDispatches = new Set<Promise<void>>();

  const post = (message: Record<string, unknown>) => {
    if (lifecycleState === 'stopped') return;
    if (!port || !ready) {
      pendingMessages.push(message);
      return;
    }
    port.postMessage({ source: CONTENT_SOURCE, ...message });
  };

  const flush = () => {
    if (!scope?.active || !port || !ready) return;
    while (pendingMessages.length > 0) {
      port.postMessage({ source: CONTENT_SOURCE, ...pendingMessages.shift()! });
    }
  };

  const handlePortMessage = async (data: unknown, session: BridgeSessionContext) => {
    if (
      !scope?.active
      || !bridgeSessions?.accepts(session, target.location.origin, target === target.top)
    ) return;

    const message = validateBridgeMessage(data, MAIN_WORLD_SOURCE);
    if (!message) return;
    if (message.type === BRIDGE_READY_TYPE) {
      ready = true;
      flush();
      dependencies.syncRuntimeState();
      return;
    }
    if (message.type === 'SYNC_HOOK_STATE_REQUEST') {
      dependencies.syncRuntimeState();
      return;
    }
    if (message.type === 'AUGMENT_REQUEST_BODY') {
      await dependencies.handleAugmentRequestBody(message);
      return;
    }
    await dependencies.handleMainWorldMessage(message as Record<string, unknown>);
  };

  const connect = () => {
    if (!scope?.active || port) return;
    const channel = createMessageChannel();
    const session = bridgeSessions?.open(
      createSessionId(),
      target.location.origin,
      target === target.top,
    );
    if (!session) {
      channel.port1.close();
      channel.port2.close();
      return;
    }

    bridgeSession = session;
    port = scope.ownPort(channel.port1);
    port.onmessage = (event) => {
      const dispatch = handlePortMessage(event.data, session);
      pendingDispatches.add(dispatch);
      void dispatch.then(
        () => pendingDispatches.delete(dispatch),
        (error) => {
          pendingDispatches.delete(dispatch);
          dependencies.reportError('[DeepSeek++] main-world bridge dispatch failed', error);
        },
      );
    };
    port.onmessageerror = () => {
      dependencies.reportError('[DeepSeek++] main-world bridge message could not be decoded');
    };
    port.start();
    target.postMessage(
      { source: CONTENT_SOURCE, type: BRIDGE_INIT_TYPE },
      target.location.origin,
      [channel.port2],
    );
  };

  const handleHandshake = (event: Event) => {
    const messageEvent = event as MessageEvent;
    if (!isBridgeHandshakeMessage({
      value: messageEvent.data,
      actualOrigin: messageEvent.origin,
      expectedOrigin: target.location.origin,
      expectedSource: MAIN_WORLD_SOURCE,
      expectedType: BRIDGE_REQUEST_TYPE,
      alreadyConnected: Boolean(port),
      actualWindowSource: messageEvent.source,
      expectedWindowSource: target,
      actualTopLevel: target === target.top,
      requireTopLevel: true,
    })) return;
    connect();
  };

  const stop = async (_reason: ContentLifecycleStopReason) => {
    const session = bridgeSession;
    bridgeSession = null;
    bridgeSessions?.close(session ?? undefined);
    bridgeSessions = null;
    if (port) {
      port.onmessage = null;
      port.onmessageerror = null;
    }
    port = null;
    ready = false;
    pendingMessages.length = 0;
    scope = null;
    lifecycleState = 'stopped';
    while (pendingDispatches.size > 0) {
      await Promise.allSettled([...pendingDispatches]);
    }
    await dependencies.disconnectRuntimeState();
  };

  return {
    id: 'main-world-bridge',
    get ready() {
      return ready;
    },
    post,
    start(nextScope) {
      lifecycleState = 'running';
      scope = nextScope;
      bridgeSessions = createBridgeSessionController(target.location.origin);
      nextScope.listen(target, 'message', handleHandshake);
    },
    stop,
  };
}
