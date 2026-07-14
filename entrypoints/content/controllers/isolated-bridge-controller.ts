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
  ContentResourceRelease,
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
const BRIDGE_DISCONNECT_TYPE = BRIDGE_HANDSHAKE_TYPES.disconnect;

export function createIsolatedBridgeController(
  dependencies: IsolatedBridgeControllerDependencies,
): IsolatedBridgeController {
  const target = dependencies.target ?? window;
  const createMessageChannel = dependencies.createMessageChannel ?? (() => new MessageChannel());
  const createSessionId = dependencies.createSessionId ?? (() => crypto.randomUUID());
  let scope: ContentResourceScope | null = null;
  let port: MessagePort | null = null;
  let releasePort: ContentResourceRelease | null = null;
  let ready = false;
  let bridgeSession: BridgeSessionContext | null = null;
  let bridgeSessions: ReturnType<typeof createBridgeSessionController> | null = null;
  let lifecycleState: 'created' | 'running' | 'stopped' = 'created';
  let connectionGeneration = 0;
  let activeConnectionGeneration: number | null = null;
  let disconnectedGeneration = 0;
  let disconnectTask: Promise<void> | null = null;
  const pendingMessages: Record<string, unknown>[] = [];
  const pendingDispatches = new Set<Promise<void>>();

  const detachBridge = () => {
    const currentPort = port;
    const currentRelease = releasePort;
    const currentGeneration = activeConnectionGeneration;
    const session = bridgeSession;
    port = null;
    releasePort = null;
    ready = false;
    activeConnectionGeneration = null;
    bridgeSession = null;
    bridgeSessions?.close(session ?? undefined);
    if (currentPort) {
      currentPort.onmessage = null;
      currentPort.onmessageerror = null;
    }
    return { release: currentRelease, generation: currentGeneration };
  };

  const resetDetachedBridge = async (
    detached: ReturnType<typeof detachBridge>,
  ): Promise<void> => {
    const errors: unknown[] = [];
    try {
      await detached.release?.();
    } catch (error) {
      errors.push(error);
    }
    while (pendingDispatches.size > 0) {
      await Promise.allSettled([...pendingDispatches]);
    }
    if (
      detached.generation !== null
      && detached.generation > disconnectedGeneration
    ) {
      disconnectedGeneration = detached.generation;
      try {
        await dependencies.disconnectRuntimeState();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, 'DeepSeek++ isolated bridge disconnect failed.');
    }
  };

  const beginPeerDisconnect = (): Promise<void> => {
    if (disconnectTask) return disconnectTask;
    const detached = detachBridge();
    const tracked = resetDetachedBridge(detached).finally(() => {
      if (disconnectTask === tracked) disconnectTask = null;
    });
    disconnectTask = tracked;
    return tracked;
  };

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
    if (lifecycleState !== 'running' || !scope?.active || port || disconnectTask) return;
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
    connectionGeneration += 1;
    activeConnectionGeneration = connectionGeneration;
    port = channel.port1;
    releasePort = scope.addCleanup('message-port', () => channel.port1.close());
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
    if (port && isBridgeHandshakeMessage({
      value: messageEvent.data,
      actualOrigin: messageEvent.origin,
      expectedOrigin: target.location.origin,
      expectedSource: MAIN_WORLD_SOURCE,
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
      void beginPeerDisconnect().catch((error) => {
        dependencies.reportError('[DeepSeek++] main-world bridge disconnect failed', error);
      });
      return;
    }
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
    if (port) {
      target.postMessage(
        { source: CONTENT_SOURCE, type: BRIDGE_DISCONNECT_TYPE },
        target.location.origin,
      );
    }
    lifecycleState = 'stopped';
    let disconnectError: unknown;
    try {
      if (disconnectTask) await disconnectTask;
      else await resetDetachedBridge(detachBridge());
    } catch (error) {
      disconnectError = error;
    }
    pendingMessages.length = 0;
    bridgeSessions = null;
    scope = null;
    if (disconnectError) throw disconnectError;
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
