import { describe, expect, it, vi } from 'vitest';
import {
  BRIDGE_HANDSHAKE_TYPES,
  BRIDGE_READY_TYPE,
  BRIDGE_SOURCES,
} from '../core/messaging/schema';
import { createIsolatedBridgeController } from '../entrypoints/content/controllers/isolated-bridge-controller';
import { createMainWorldBridgeController } from '../entrypoints/content/controllers/main-world-bridge-controller';
import { createContentLifecycleKernel } from '../entrypoints/content/lifecycle';

describe('content bridge controllers', () => {
  it('binds an isolated Port to one epoch and gives stale handlers zero dispatch', async () => {
    const target = createFakeWindow();
    const isolatedPort = createFakePort();
    const transferredPort = createFakePort();
    const syncRuntimeState = vi.fn();
    const handleMainWorldMessage = vi.fn();
    const controller = createIsolatedBridgeController({
      target,
      createSessionId: () => 'isolated-session',
      createMessageChannel: () => ({
        port1: isolatedPort as unknown as MessagePort,
        port2: transferredPort as unknown as MessagePort,
      } as MessageChannel),
      handleAugmentRequestBody: vi.fn(async () => undefined),
      handleMainWorldMessage,
      syncRuntimeState,
      disconnectRuntimeState: vi.fn(async () => undefined),
      reportError: vi.fn(),
    });
    const kernel = createContentLifecycleKernel([controller]);
    await kernel.start();

    target.dispatchEvent(createHandshakeEvent(target, {
      source: BRIDGE_SOURCES.mainWorld,
      type: BRIDGE_HANDSHAKE_TYPES.request,
    }));
    const staleHandler = isolatedPort.onmessage;
    isolatedPort.emit({ source: BRIDGE_SOURCES.mainWorld, type: BRIDGE_READY_TYPE });
    expect(syncRuntimeState).toHaveBeenCalledOnce();

    controller.post({ type: 'SYNC_HOOK_STATE', toolDescriptors: [] });
    expect(isolatedPort.postMessage).toHaveBeenLastCalledWith({
      source: BRIDGE_SOURCES.content,
      type: 'SYNC_HOOK_STATE',
      toolDescriptors: [],
    });

    await kernel.stop('pagehide');
    await staleHandler?.({
      data: {
        source: BRIDGE_SOURCES.mainWorld,
        type: 'MEMORIES_USED',
        ids: [1],
      },
    } as MessageEvent);
    expect(handleMainWorldMessage).not.toHaveBeenCalled();
    expect(isolatedPort.close).toHaveBeenCalledOnce();
    expect(kernel.snapshot().resources.total).toBe(0);
  });

  it('rejects pending MAIN augmentation on stop and opens a clean next epoch', async () => {
    const target = createFakeWindow();
    const port = createFakePort();
    const applyState = vi.fn();
    const controller = createMainWorldBridgeController({
      target,
      createSessionId: (() => {
        let index = 0;
        return () => `id-${++index}`;
      })(),
      applyState,
      clearState: vi.fn(),
      reportError: vi.fn(),
    });
    const kernel = createContentLifecycleKernel([controller]);
    await kernel.start();

    target.dispatchEvent(createHandshakeEvent(target, {
      source: BRIDGE_SOURCES.content,
      type: BRIDGE_HANDSHAKE_TYPES.init,
    }, [port as unknown as MessagePort]));
    expect(port.postMessage).toHaveBeenCalledWith({
      source: BRIDGE_SOURCES.mainWorld,
      type: BRIDGE_READY_TYPE,
    });

    const pending = controller.requestAugmentedBody('{}', 'request-1');
    const staleHandler = port.onmessage;
    await kernel.stop('pagehide');
    await expect(pending).rejects.toThrow('main/content bridge disconnected');
    await staleHandler?.({
      data: {
        source: BRIDGE_SOURCES.content,
        type: 'SYNC_HOOK_STATE',
        toolDescriptors: [],
        skillSummaries: [],
        skillPopupCopy: {},
      },
    } as MessageEvent);
    expect(applyState).not.toHaveBeenCalled();
    expect(kernel.snapshot().resources.total).toBe(0);

    await expect(kernel.start()).resolves.toBe(2);
    await kernel.stop('manual');
  });

  it('gates isolated ingress and drains active augmentation before authorization cleanup', async () => {
    const target = createFakeWindow();
    const isolatedPort = createFakePort();
    const transferredPort = createFakePort();
    let finishAugmentation!: () => void;
    const handleAugmentRequestBody = vi.fn(() => new Promise<void>((resolve) => {
      finishAugmentation = resolve;
    }));
    const disconnectRuntimeState = vi.fn(async () => undefined);
    const controller = createIsolatedBridgeController({
      target,
      createSessionId: () => 'isolated-session',
      createMessageChannel: () => ({
        port1: isolatedPort as unknown as MessagePort,
        port2: transferredPort as unknown as MessagePort,
      } as MessageChannel),
      handleAugmentRequestBody,
      handleMainWorldMessage: vi.fn(),
      syncRuntimeState: vi.fn(),
      disconnectRuntimeState,
      reportError: vi.fn(),
    });
    const kernel = createContentLifecycleKernel([controller]);
    await kernel.start();
    target.dispatchEvent(createHandshakeEvent(target, {
      source: BRIDGE_SOURCES.mainWorld,
      type: BRIDGE_HANDSHAKE_TYPES.request,
    }));

    isolatedPort.emit({
      source: BRIDGE_SOURCES.mainWorld,
      type: 'AUGMENT_REQUEST_BODY',
      id: 'augment-1',
      requestId: 'request-1',
      body: '{}',
    });
    await Promise.resolve();
    expect(handleAugmentRequestBody).toHaveBeenCalledOnce();

    let stopped = false;
    const stopping = kernel.stop('reinjection').then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(disconnectRuntimeState).not.toHaveBeenCalled();

    finishAugmentation();
    await stopping;
    expect(disconnectRuntimeState).toHaveBeenCalledOnce();
    expect(kernel.snapshot().resources.total).toBe(0);
  });

  it('reconnects when either bridge world restarts without a full page reload', async () => {
    vi.useFakeTimers();
    const target = createLoopbackFakeWindow();
    const syncRuntimeState = vi.fn();
    const disconnectRuntimeState = vi.fn(async () => undefined);
    const mainController = createMainWorldBridgeController({
      target,
      createSessionId: createSequentialId('main'),
      applyState: vi.fn(),
      clearState: vi.fn(),
      reportError: vi.fn(),
    });
    const isolatedController = createIsolatedBridgeController({
      target,
      createSessionId: createSequentialId('isolated'),
      createMessageChannel: () => createLinkedFakeMessageChannel() as unknown as MessageChannel,
      handleAugmentRequestBody: vi.fn(async () => undefined),
      handleMainWorldMessage: vi.fn(),
      syncRuntimeState,
      disconnectRuntimeState,
      reportError: vi.fn(),
    });
    const mainKernel = createContentLifecycleKernel([mainController]);
    const isolatedKernel = createContentLifecycleKernel([isolatedController]);

    try {
      await mainKernel.start();
      await isolatedKernel.start();
      await vi.advanceTimersByTimeAsync(50);
      await flushBridgeEvents();
      expect(isolatedController.ready).toBe(true);
      expect(syncRuntimeState).toHaveBeenCalledTimes(1);

      await isolatedKernel.stop('reinjection');
      await flushBridgeEvents();
      expect(disconnectRuntimeState).toHaveBeenCalledTimes(1);
      await isolatedKernel.start();
      await vi.advanceTimersByTimeAsync(50);
      await flushBridgeEvents();
      expect(isolatedController.ready).toBe(true);
      expect(syncRuntimeState).toHaveBeenCalledTimes(2);

      await mainKernel.stop('reinjection');
      await flushBridgeEvents();
      expect(disconnectRuntimeState).toHaveBeenCalledTimes(2);
      await mainKernel.start();
      await vi.advanceTimersByTimeAsync(50);
      await flushBridgeEvents();
      expect(isolatedController.ready).toBe(true);
      expect(syncRuntimeState).toHaveBeenCalledTimes(3);
    } finally {
      await Promise.allSettled([
        isolatedKernel.stop('manual'),
        mainKernel.stop('manual'),
      ]);
      await flushBridgeEvents();
      vi.useRealTimers();
    }

    expect(mainKernel.snapshot().resources.total).toBe(0);
    expect(isolatedKernel.snapshot().resources.total).toBe(0);
  });
});

interface FakePort {
  onmessage: ((event: MessageEvent) => unknown) | null;
  onmessageerror: ((event: MessageEvent) => unknown) | null;
  postMessage: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  emit(data: unknown): void;
}

function createFakePort(): FakePort {
  return {
    onmessage: null,
    onmessageerror: null,
    postMessage: vi.fn(),
    start: vi.fn(),
    close: vi.fn(),
    emit(data) {
      void this.onmessage?.({ data } as MessageEvent);
    },
  };
}

function createLinkedFakeMessageChannel(): { port1: FakePort; port2: FakePort } {
  const port1 = createFakePort();
  const port2 = createFakePort();
  port1.postMessage.mockImplementation((data: unknown) => {
    queueMicrotask(() => port2.emit(data));
  });
  port2.postMessage.mockImplementation((data: unknown) => {
    queueMicrotask(() => port1.emit(data));
  });
  return { port1, port2 };
}

function createFakeWindow(): Window {
  const target = new EventTarget() as EventTarget & {
    location: { origin: string };
    top: unknown;
    postMessage: ReturnType<typeof vi.fn>;
  };
  target.location = { origin: 'https://chat.deepseek.com' };
  target.top = target;
  target.postMessage = vi.fn();
  return target as unknown as Window;
}

function createLoopbackFakeWindow(): Window {
  const target = createFakeWindow() as Window & {
    postMessage: ReturnType<typeof vi.fn>;
  };
  target.postMessage.mockImplementation((
    data: Record<string, unknown>,
    _targetOrigin: string,
    transfer: MessagePort[] = [],
  ) => {
    queueMicrotask(() => {
      target.dispatchEvent(createHandshakeEvent(target, data, transfer));
    });
  });
  return target;
}

function createSequentialId(prefix: string): () => string {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

async function flushBridgeEvents(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function createHandshakeEvent(
  source: Window,
  data: Record<string, unknown>,
  ports: MessagePort[] = [],
): MessageEvent {
  return new MessageEvent('message', {
    data,
    origin: source.location.origin,
    source,
    ports,
  });
}
