import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMainWorldNavigationController,
} from '../entrypoints/content/controllers/main-world-navigation-controller';
import { createContentLifecycleKernel } from '../entrypoints/content/lifecycle';

const LEGACY_ROUTE_WATCHER_COUNT = 2;
const LEGACY_ROUTE_POLL_INTERVAL_MS = 500;
const IDLE_TRACE_DURATION_MS = 10_000;

describe('MAIN-world navigation controller', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('replaces the recorded polling baseline with one fixed event trace', async () => {
    vi.useFakeTimers();
    const onNavigate = vi.fn();
    const kernel = createContentLifecycleKernel([
      createMainWorldNavigationController({ onNavigate }),
    ]);

    try {
      await kernel.start();
      const preChangeIdleCallbacks = LEGACY_ROUTE_WATCHER_COUNT
        * (IDLE_TRACE_DURATION_MS / LEGACY_ROUTE_POLL_INTERVAL_MS);
      expect(preChangeIdleCallbacks).toBe(40);

      vi.advanceTimersByTime(IDLE_TRACE_DURATION_MS);
      expect(onNavigate).not.toHaveBeenCalled();

      window.history.pushState({}, '', '/a/chat/s/one');
      window.history.replaceState({}, '', '/a/chat/s/two');
      window.dispatchEvent(new PopStateEvent('popstate'));
      window.dispatchEvent(new HashChangeEvent('hashchange'));

      expect(onNavigate).toHaveBeenCalledTimes(4);
      expect(kernel.snapshot().resources).toMatchObject({
        total: 3,
        byKind: { listener: 2, cleanup: 1, interval: 0 },
      });

      await kernel.stop('manual');
      expect(kernel.snapshot().resources.total).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores History methods and gives stale callbacks zero work after teardown', async () => {
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;
    const onNavigate = vi.fn();
    const kernel = createContentLifecycleKernel([
      createMainWorldNavigationController({ onNavigate }),
    ]);

    await kernel.start();
    expect(window.history.pushState).not.toBe(originalPushState);
    expect(window.history.replaceState).not.toBe(originalReplaceState);
    await kernel.stop('reinjection');

    expect(window.history.pushState).toBe(originalPushState);
    expect(window.history.replaceState).toBe(originalReplaceState);
    window.history.pushState({}, '', '/a/chat/s/after-stop');
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
