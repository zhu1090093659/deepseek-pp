export type ContentLifecycleStopReason =
  | 'pagehide'
  | 'reinjection'
  | 'extension-invalidated'
  | 'manual'
  | 'startup-failed';

export type ContentResourceKind =
  | 'listener'
  | 'observer'
  | 'timeout'
  | 'interval'
  | 'animation-frame'
  | 'dom-root'
  | 'message-port'
  | 'cleanup';

export interface ContentResourceSnapshot {
  readonly total: number;
  readonly byKind: Readonly<Record<ContentResourceKind, number>>;
}

export type ContentResourceRelease = () => Promise<void>;

export interface ContentLifecycleSnapshot {
  readonly state: 'stopped' | 'starting' | 'running' | 'stopping';
  readonly epoch: number;
  readonly resources: ContentResourceSnapshot;
  readonly capabilities: Readonly<Record<string, ContentResourceSnapshot>>;
}

export interface ContentResourceScope {
  readonly signal: AbortSignal;
  readonly active: boolean;
  addCleanup(
    kind: ContentResourceKind,
    cleanup: () => void | Promise<void>,
  ): ContentResourceRelease;
  listen(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): ContentResourceRelease;
  observe(
    observer: { disconnect(): void },
    target: Node,
    options: MutationObserverInit,
  ): ContentResourceRelease;
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
  setInterval(callback: () => void, delayMs: number): ReturnType<typeof setInterval>;
  clearInterval(timer: ReturnType<typeof setInterval>): void;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(frame: number): void;
  ownRoot<T extends Node>(root: T): T;
  ownPort<T extends MessagePort>(port: T): T;
  snapshot(): ContentResourceSnapshot;
}

export interface ContentCapabilityController {
  readonly id: string;
  start(scope: ContentResourceScope, epoch: number): void | Promise<void>;
  stop(reason: ContentLifecycleStopReason): void | Promise<void>;
}

export interface ContentLifecycleKernel {
  start(): Promise<number>;
  stop(reason: ContentLifecycleStopReason): Promise<void>;
  snapshot(): ContentLifecycleSnapshot;
}

export interface ContentDocumentLifecycle {
  readonly kernel: ContentLifecycleKernel;
  start(): Promise<number>;
  dispose(reason: ContentLifecycleStopReason): Promise<void>;
}

const CONTENT_DOCUMENT_LIFECYCLE_KEY = Symbol.for('deepseek-pp.content-document-lifecycle');

interface OwnedResource {
  readonly kind: ContentResourceKind;
  readonly cleanup: () => void | Promise<void>;
  releaseTask?: Promise<void>;
}

const RESOURCE_KINDS: readonly ContentResourceKind[] = [
  'listener',
  'observer',
  'timeout',
  'interval',
  'animation-frame',
  'dom-root',
  'message-port',
  'cleanup',
];

const EMPTY_RESOURCE_COUNTS = (): Record<ContentResourceKind, number> => ({
  listener: 0,
  observer: 0,
  timeout: 0,
  interval: 0,
  'animation-frame': 0,
  'dom-root': 0,
  'message-port': 0,
  cleanup: 0,
});

export function createContentLifecycleKernel(
  capabilities: readonly ContentCapabilityController[],
): ContentLifecycleKernel {
  assertUniqueCapabilityIds(capabilities);

  let state: ContentLifecycleSnapshot['state'] = 'stopped';
  let epoch = 0;
  let transition = Promise.resolve<unknown>(undefined);
  const activeCapabilities: Array<{
    controller: ContentCapabilityController;
    scope: OwnedContentResourceScope;
  }> = [];

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = transition.then(operation, operation);
    transition = next.then(() => undefined, () => undefined);
    return next;
  };

  const start = () => enqueue(async () => {
    if (state === 'running') return epoch;
    state = 'starting';
    epoch += 1;

    try {
      for (const controller of capabilities) {
        const scope = new OwnedContentResourceScope();
        activeCapabilities.push({ controller, scope });
        await controller.start(scope, epoch);
      }
      state = 'running';
      return epoch;
    } catch (error) {
      const cleanupErrors = await stopActiveCapabilities('startup-failed');
      state = 'stopped';
      if (cleanupErrors.length === 0) throw error;
      throw new AggregateError([error, ...cleanupErrors], 'Content lifecycle startup failed.');
    }
  });

  const stop = (reason: ContentLifecycleStopReason) => enqueue(async () => {
    if (state === 'stopped') return;
    state = 'stopping';
    const errors = await stopActiveCapabilities(reason);
    state = 'stopped';
    if (errors.length > 0) {
      throw new AggregateError(errors, `Content lifecycle stop failed: ${reason}.`);
    }
  });

  const stopActiveCapabilities = async (
    reason: ContentLifecycleStopReason,
  ): Promise<unknown[]> => {
    const errors: unknown[] = [];
    while (activeCapabilities.length > 0) {
      const active = activeCapabilities.pop()!;
      try {
        await active.controller.stop(reason);
      } catch (error) {
        errors.push(error);
      }
      try {
        await active.scope.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  };

  const snapshot = (): ContentLifecycleSnapshot => {
    const capabilitiesSnapshot: Record<string, ContentResourceSnapshot> = {};
    const totals = EMPTY_RESOURCE_COUNTS();
    for (const active of activeCapabilities) {
      const resourceSnapshot = active.scope.snapshot();
      capabilitiesSnapshot[active.controller.id] = resourceSnapshot;
      for (const kind of RESOURCE_KINDS) totals[kind] += resourceSnapshot.byKind[kind];
    }
    return Object.freeze({
      state,
      epoch,
      resources: freezeResourceSnapshot(totals),
      capabilities: Object.freeze(capabilitiesSnapshot),
    });
  };

  return Object.freeze({ start, stop, snapshot });
}

export function createContentDocumentLifecycle(options: {
  readonly capabilities: readonly ContentCapabilityController[];
  readonly target?: Window;
  readonly onError: (error: unknown) => void;
}): ContentDocumentLifecycle {
  const target = options.target ?? window;
  const kernel = createContentLifecycleKernel(options.capabilities);
  let documentListenersInstalled = false;
  let disposed = false;
  let disposeTask: Promise<void> | null = null;

  const onPageHide = () => {
    void kernel.stop('pagehide').catch(options.onError);
  };
  const onPageShow = (event: Event) => {
    if (disposed || !(event as PageTransitionEvent).persisted) return;
    void kernel.start().catch(options.onError);
  };

  const installDocumentListeners = () => {
    if (documentListenersInstalled) return;
    target.addEventListener('pagehide', onPageHide);
    target.addEventListener('pageshow', onPageShow);
    documentListenersInstalled = true;
  };

  const start = async () => {
    if (disposed) throw new Error('Content document lifecycle is disposed.');
    installDocumentListeners();
    return kernel.start();
  };

  const dispose = (reason: ContentLifecycleStopReason): Promise<void> => {
    if (disposeTask) return disposeTask;
    disposed = true;
    if (documentListenersInstalled) {
      target.removeEventListener('pagehide', onPageHide);
      target.removeEventListener('pageshow', onPageShow);
      documentListenersInstalled = false;
    }
    disposeTask = kernel.stop(reason);
    return disposeTask;
  };

  return Object.freeze({ kernel, start, dispose });
}

export async function replaceContentDocumentLifecycle(options: {
  readonly capabilities: readonly ContentCapabilityController[];
  readonly target?: Window;
  readonly onError: (error: unknown) => void;
}): Promise<ContentDocumentLifecycle> {
  const target = options.target ?? window;
  const lifecycleOwner = target as unknown as Record<symbol, ContentDocumentLifecycle | undefined>;
  const previous = lifecycleOwner[CONTENT_DOCUMENT_LIFECYCLE_KEY];
  if (previous) await previous.dispose('reinjection');

  const next = createContentDocumentLifecycle({ ...options, target });
  lifecycleOwner[CONTENT_DOCUMENT_LIFECYCLE_KEY] = next;
  try {
    await next.start();
    return next;
  } catch (error) {
    if (lifecycleOwner[CONTENT_DOCUMENT_LIFECYCLE_KEY] === next) {
      delete lifecycleOwner[CONTENT_DOCUMENT_LIFECYCLE_KEY];
    }
    await next.dispose('startup-failed').catch((cleanupError) => {
      throw new AggregateError([error, cleanupError], 'Content document lifecycle installation failed.');
    });
    throw error;
  }
}

class OwnedContentResourceScope implements ContentResourceScope {
  readonly #abort = new AbortController();
  readonly #resources = new Map<unknown, OwnedResource>();
  readonly #timeoutTokens = new Map<ReturnType<typeof setTimeout>, object>();
  readonly #intervalTokens = new Map<ReturnType<typeof setInterval>, object>();
  readonly #animationFrameTokens = new Map<number, object>();
  #active = true;

  get signal(): AbortSignal {
    return this.#abort.signal;
  }

  get active(): boolean {
    return this.#active;
  }

  addCleanup(
    kind: ContentResourceKind,
    cleanup: () => void | Promise<void>,
  ): ContentResourceRelease {
    this.assertActive();
    const token = {};
    const resource: OwnedResource = { kind, cleanup };
    this.#resources.set(token, resource);
    return () => {
      const current = this.#resources.get(token);
      return current ? this.releaseResource(token, current) : Promise.resolve();
    };
  }

  listen(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): ContentResourceRelease {
    target.addEventListener(type, listener, options);
    return this.addCleanup('listener', () => target.removeEventListener(type, listener, options));
  }

  observe(
    observer: { observe(target: Node, options?: MutationObserverInit): void; disconnect(): void },
    target: Node,
    options: MutationObserverInit,
  ): ContentResourceRelease {
    observer.observe(target, options);
    return this.addCleanup('observer', () => observer.disconnect());
  }

  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    this.assertActive();
    const token = {};
    let timer: ReturnType<typeof setTimeout>;
    timer = globalThis.setTimeout(() => {
      this.#timeoutTokens.delete(timer);
      this.#resources.delete(token);
      if (this.#active) callback();
    }, delayMs);
    this.#timeoutTokens.set(timer, token);
    this.#resources.set(token, { kind: 'timeout', cleanup: () => globalThis.clearTimeout(timer) });
    return timer;
  }

  clearTimeout(timer: ReturnType<typeof setTimeout>): void {
    this.releaseTimer(this.#timeoutTokens, timer);
  }

  setInterval(callback: () => void, delayMs: number): ReturnType<typeof setInterval> {
    this.assertActive();
    const token = {};
    const timer = globalThis.setInterval(() => {
      if (this.#active) callback();
    }, delayMs);
    this.#intervalTokens.set(timer, token);
    this.#resources.set(token, { kind: 'interval', cleanup: () => globalThis.clearInterval(timer) });
    return timer;
  }

  clearInterval(timer: ReturnType<typeof setInterval>): void {
    this.releaseTimer(this.#intervalTokens, timer);
  }

  requestAnimationFrame(callback: FrameRequestCallback): number {
    this.assertActive();
    const token = {};
    const frame = window.requestAnimationFrame((time) => {
      this.#animationFrameTokens.delete(frame);
      this.#resources.delete(token);
      if (this.#active) callback(time);
    });
    this.#animationFrameTokens.set(frame, token);
    this.#resources.set(token, {
      kind: 'animation-frame',
      cleanup: () => window.cancelAnimationFrame(frame),
    });
    return frame;
  }

  cancelAnimationFrame(frame: number): void {
    this.releaseTimer(this.#animationFrameTokens, frame);
  }

  ownRoot<T extends Node>(root: T): T {
    this.assertActive();
    this.#resources.set(root, {
      kind: 'dom-root',
      cleanup: () => {
        if (root.parentNode) root.parentNode.removeChild(root);
      },
    });
    return root;
  }

  ownPort<T extends MessagePort>(port: T): T {
    this.assertActive();
    this.#resources.set(port, {
      kind: 'message-port',
      cleanup: () => port.close(),
    });
    return port;
  }

  snapshot(): ContentResourceSnapshot {
    const counts = EMPTY_RESOURCE_COUNTS();
    for (const resource of this.#resources.values()) counts[resource.kind] += 1;
    return freezeResourceSnapshot(counts);
  }

  async dispose(): Promise<void> {
    if (!this.#active) return;
    this.#active = false;
    this.#abort.abort(new Error('Content capability stopped.'));
    const resources = [...this.#resources.entries()].reverse();
    this.#timeoutTokens.clear();
    this.#intervalTokens.clear();
    this.#animationFrameTokens.clear();
    const errors: unknown[] = [];
    for (const [token, resource] of resources) {
      try {
        await this.releaseResource(token, resource);
      } catch (error) {
        errors.push(error);
        this.#resources.delete(token);
      }
    }
    this.#resources.clear();
    if (errors.length > 0) throw new AggregateError(errors, 'Content resource cleanup failed.');
  }

  private releaseResource(token: unknown, resource: OwnedResource): Promise<void> {
    if (resource.releaseTask) return resource.releaseTask;
    let resolveTask!: () => void;
    let rejectTask!: (error: unknown) => void;
    const task = new Promise<void>((resolve, reject) => {
      resolveTask = resolve;
      rejectTask = reject;
    });
    resource.releaseTask = task;

    const finish = () => {
      if (this.#resources.get(token) === resource) this.#resources.delete(token);
      if (resource.releaseTask === task) resource.releaseTask = undefined;
      resolveTask();
    };
    const fail = (error: unknown) => {
      if (resource.releaseTask === task) resource.releaseTask = undefined;
      rejectTask(error);
    };
    try {
      const result = resource.cleanup();
      if (result && typeof result.then === 'function') void result.then(finish, fail);
      else finish();
    } catch (error) {
      fail(error);
    }
    return task;
  }

  #release(token: unknown): void {
    const resource = this.#resources.get(token);
    if (!resource) return;
    this.#resources.delete(token);
    void resource.cleanup();
  }

  private releaseTimer<T>(tokens: Map<T, object>, handle: T): void {
    const token = tokens.get(handle);
    if (!token) return;
    tokens.delete(handle);
    this.#release(token);
  }

  private assertActive(): void {
    if (!this.#active) throw new Error('Content resource scope is stopped.');
  }
}

function assertUniqueCapabilityIds(capabilities: readonly ContentCapabilityController[]): void {
  const ids = new Set<string>();
  for (const capability of capabilities) {
    if (!capability.id.trim()) throw new Error('Content capability id is required.');
    if (ids.has(capability.id)) throw new Error(`Duplicate content capability: ${capability.id}.`);
    ids.add(capability.id);
  }
}

function freezeResourceSnapshot(
  byKind: Record<ContentResourceKind, number>,
): ContentResourceSnapshot {
  return Object.freeze({
    total: Object.values(byKind).reduce((sum, count) => sum + count, 0),
    byKind: Object.freeze(byKind),
  });
}
