import { describe, expect, it, vi } from 'vitest';
import { createContentMutationHub } from '../entrypoints/content/controllers/mutation-hub';
import { createContentLifecycleKernel } from '../entrypoints/content/lifecycle';

const LEGACY_FULL_PAGE_OBSERVER_COUNT = 6;
const FIXED_MUTATION_BATCH_COUNT = 20;

describe('Content mutation performance trace', () => {
  it('consolidates the fixed mutation trace into one observer and filters callback work', async () => {
    document.body.innerHTML = '<main id="root"><section id="stream"></section></main>';
    let deliver!: MutationCallback;
    const disconnect = vi.fn();
    const observe = vi.fn();
    const reportError = vi.fn();
    const hub = createContentMutationHub({
      reportError,
      createObserver(callback) {
        deliver = callback;
        return { observe, disconnect } as unknown as MutationObserver;
      },
    });
    const relevantCallback = vi.fn();
    const kernel = createContentLifecycleKernel([
      {
        id: 'mutation-hub',
        start(scope) {
          hub.start(scope);
        },
        stop() {
          hub.stop();
        },
      },
      {
        id: 'filtered-subscriber',
        start(scope) {
          scope.addCleanup('cleanup', hub.subscribe({
            matches: (mutations) => mutations.some((mutation) => mutation.type === 'childList'),
            handle: relevantCallback,
          }));
        },
        stop() {},
      },
    ]);
    await kernel.start();

    const irrelevant = [{ type: 'characterData' }] as MutationRecord[];
    for (let index = 0; index < FIXED_MUTATION_BATCH_COUNT; index += 1) {
      deliver(irrelevant, {} as MutationObserver);
    }
    deliver([{ type: 'childList' }] as MutationRecord[], {} as MutationObserver);

    const batches = FIXED_MUTATION_BATCH_COUNT + 1;
    expect(LEGACY_FULL_PAGE_OBSERVER_COUNT * batches).toBe(126);
    expect(hub.snapshot()).toEqual({
      deliveries: batches,
      subscriberCallbacks: 1,
      subscribers: 1,
    });
    expect(relevantCallback).toHaveBeenCalledOnce();
    expect(reportError).not.toHaveBeenCalled();
    expect(observe).toHaveBeenCalledWith(document.getElementById('root'), {
      childList: true,
      subtree: true,
      characterData: true,
    });

    await kernel.stop('manual');
    expect(disconnect).toHaveBeenCalledOnce();
    expect(kernel.snapshot().resources.total).toBe(0);
  });
});
