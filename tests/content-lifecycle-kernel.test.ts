import { describe, expect, it, vi } from 'vitest';
import {
  createContentDocumentLifecycle,
  createContentLifecycleKernel,
  replaceContentDocumentLifecycle,
  type ContentCapabilityController,
} from '../entrypoints/content/lifecycle';

describe('content lifecycle kernel', () => {
  it('starts once, stops in reverse order, and releases every owned resource', async () => {
    const events: string[] = [];
    const target = new EventTarget();
    const root = document.createElement('div');
    document.body.append(root);

    const first: ContentCapabilityController = {
      id: 'first',
      start(scope, epoch) {
        events.push(`start:first:${epoch}`);
        scope.listen(target, 'ping', () => events.push('ping'));
        scope.ownRoot(root);
      },
      stop(reason) {
        events.push(`stop:first:${reason}`);
      },
    };
    const second: ContentCapabilityController = {
      id: 'second',
      start(_scope, epoch) {
        events.push(`start:second:${epoch}`);
      },
      stop(reason) {
        events.push(`stop:second:${reason}`);
      },
    };

    const kernel = createContentLifecycleKernel([first, second]);
    await expect(kernel.start()).resolves.toBe(1);
    await expect(kernel.start()).resolves.toBe(1);
    target.dispatchEvent(new Event('ping'));

    expect(kernel.snapshot()).toMatchObject({
      state: 'running',
      epoch: 1,
      resources: { total: 2 },
      capabilities: { first: { total: 2 }, second: { total: 0 } },
    });

    await kernel.stop('manual');
    await kernel.stop('manual');
    target.dispatchEvent(new Event('ping'));

    expect(events).toEqual([
      'start:first:1',
      'start:second:1',
      'ping',
      'stop:second:manual',
      'stop:first:manual',
    ]);
    expect(root.isConnected).toBe(false);
    expect(kernel.snapshot()).toMatchObject({ state: 'stopped', resources: { total: 0 } });
  });

  it('rolls back a partial startup and does not poison the next epoch', async () => {
    let fail = true;
    const stop = vi.fn();
    const kernel = createContentLifecycleKernel([
      {
        id: 'stable',
        start(scope) {
          scope.setInterval(() => undefined, 1000);
        },
        stop,
      },
      {
        id: 'flaky',
        start() {
          if (fail) throw new Error('startup failed');
        },
        stop,
      },
    ]);

    await expect(kernel.start()).rejects.toThrow('startup failed');
    expect(kernel.snapshot()).toMatchObject({ state: 'stopped', resources: { total: 0 } });
    fail = false;
    await expect(kernel.start()).resolves.toBe(2);
    await kernel.stop('manual');
    expect(stop).toHaveBeenCalledTimes(4);
  });

  it('rejects duplicate ownership before any capability starts', () => {
    const capability: ContentCapabilityController = {
      id: 'duplicate',
      start() {},
      stop() {},
    };
    expect(() => createContentLifecycleKernel([capability, capability]))
      .toThrow('Duplicate content capability: duplicate.');
  });

  it('opens a fresh epoch after BFCache pagehide/pageshow without duplicating listeners', async () => {
    const events: string[] = [];
    const target = new EventTarget() as Window;
    const errors: unknown[] = [];
    const lifecycle = createContentDocumentLifecycle({
      target,
      onError: (error) => errors.push(error),
      capabilities: [{
        id: 'bridge',
        start(_scope, epoch) {
          events.push(`start:${epoch}`);
        },
        stop(reason) {
          events.push(`stop:${reason}`);
        },
      }],
    });

    await lifecycle.start();
    await lifecycle.start();
    target.dispatchEvent(new Event('pagehide'));
    await settleTransitions();
    const pageShow = new Event('pageshow');
    Object.defineProperty(pageShow, 'persisted', { value: true });
    target.dispatchEvent(pageShow);
    await settleTransitions();

    expect(events).toEqual(['start:1', 'stop:pagehide', 'start:2']);
    expect(errors).toEqual([]);
    await lifecycle.dispose('reinjection');
    target.dispatchEvent(pageShow);
    await settleTransitions();
    expect(events).toEqual(['start:1', 'stop:pagehide', 'start:2', 'stop:reinjection']);
  });

  it('stops the previous document owner before a reinjected owner starts', async () => {
    const events: string[] = [];
    const target = new EventTarget() as Window;
    const createCapability = (name: string): ContentCapabilityController => ({
      id: name,
      start() {
        events.push(`start:${name}`);
      },
      stop(reason) {
        events.push(`stop:${name}:${reason}`);
      },
    });

    await replaceContentDocumentLifecycle({
      target,
      onError: (error) => { throw error; },
      capabilities: [createCapability('first')],
    });
    const second = await replaceContentDocumentLifecycle({
      target,
      onError: (error) => { throw error; },
      capabilities: [createCapability('second')],
    });

    expect(events).toEqual(['start:first', 'stop:first:reinjection', 'start:second']);
    await second.dispose('manual');
  });

  it('shares one in-flight dispose so reinjection cannot overtake teardown', async () => {
    let releaseStop!: () => void;
    const target = new EventTarget() as Window;
    const lifecycle = createContentDocumentLifecycle({
      target,
      onError: (error) => { throw error; },
      capabilities: [{
        id: 'slow-stop',
        start() {},
        stop: () => new Promise<void>((resolve) => {
          releaseStop = resolve;
        }),
      }],
    });
    await lifecycle.start();

    const first = lifecycle.dispose('reinjection');
    const second = lifecycle.dispose('manual');
    expect(second).toBe(first);

    let settled = false;
    void second.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseStop();
    await first;
    expect(settled).toBe(true);
  });

  it('keeps a failed async manual release observable and retries it during dispose', async () => {
    const cleanupFailure = new Error('async cleanup failed');
    let cleanupAttempts = 0;
    let release!: () => Promise<void>;
    const kernel = createContentLifecycleKernel([{
      id: 'async-cleanup',
      start(scope) {
        release = scope.addCleanup('cleanup', async () => {
          cleanupAttempts += 1;
          if (cleanupAttempts === 1) throw cleanupFailure;
        });
      },
      stop() {},
    }]);
    await kernel.start();

    await expect(release()).rejects.toBe(cleanupFailure);
    expect(kernel.snapshot().resources.total).toBe(1);

    await kernel.stop('manual');
    expect(cleanupAttempts).toBe(2);
    expect(kernel.snapshot().resources.total).toBe(0);
  });

  it('shares an in-flight manual release with concurrent disposal', async () => {
    let finishCleanup!: () => void;
    const cleanup = vi.fn(() => new Promise<void>((resolve) => {
      finishCleanup = resolve;
    }));
    let release!: () => Promise<void>;
    const kernel = createContentLifecycleKernel([{
      id: 'concurrent-cleanup',
      start(scope) {
        release = scope.addCleanup('cleanup', cleanup);
      },
      stop() {},
    }]);
    await kernel.start();

    const manualRelease = release();
    await Promise.resolve();
    const disposal = kernel.stop('manual');
    await Promise.resolve();

    expect(cleanup).toHaveBeenCalledTimes(1);
    finishCleanup();
    await Promise.all([manualRelease, disposal]);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(kernel.snapshot().resources.total).toBe(0);
  });
});

async function settleTransitions(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
}
