import { describe, expect, it, vi } from 'vitest';
import {
  startChatLauncherPageLifecycle,
  type ChatLauncherPageLifecycleDependencies,
} from '../entrypoints/content/adapters/chat-launcher-page-lifecycle';

describe('floating chat page lifecycle', () => {
  it('suspends on pagehide and restarts only for BFCache restore', () => {
    const harness = createHarness();
    const lifecycle = startChatLauncherPageLifecycle(harness.dependencies);
    expect(harness.startLauncher).toHaveBeenCalledTimes(1);

    harness.dispatch('pagehide', false);
    expect(harness.stops).toEqual(['launcher-1']);
    harness.dispatch('pageshow', false);
    expect(harness.startLauncher).toHaveBeenCalledTimes(1);
    harness.dispatch('pageshow', true);
    expect(harness.startLauncher).toHaveBeenCalledTimes(2);

    lifecycle.stop();
    expect(harness.stops).toEqual(['launcher-1', 'launcher-2']);
    expect(harness.listenerCount()).toBe(0);
  });

  it('replaces the active lifecycle and makes teardown idempotent', () => {
    const first = createHarness();
    const firstLifecycle = startChatLauncherPageLifecycle(first.dependencies);
    const second = createHarness();
    const secondLifecycle = startChatLauncherPageLifecycle(second.dependencies);

    expect(first.stops).toEqual(['launcher-1']);
    expect(first.listenerCount()).toBe(0);
    firstLifecycle.stop();
    expect(first.stops).toEqual(['launcher-1']);

    secondLifecycle.stop();
    secondLifecycle.stop();
    expect(second.stops).toEqual(['launcher-1']);
    expect(second.listenerCount()).toBe(0);
  });
});

function createHarness() {
  const listeners = new Map<string, Set<(event: PageTransitionEvent) => void>>();
  const stops: string[] = [];
  let sequence = 0;
  const startLauncher = vi.fn(() => {
    const id = `launcher-${++sequence}`;
    return { stop: vi.fn(() => stops.push(id)) };
  });
  const dependencies: ChatLauncherPageLifecycleDependencies = {
    startLauncher,
    addPageListener(type, listener) {
      const registered = listeners.get(type) ?? new Set();
      registered.add(listener);
      listeners.set(type, registered);
    },
    removePageListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
  };
  return {
    dependencies,
    startLauncher,
    stops,
    dispatch(type: 'pagehide' | 'pageshow', persisted: boolean) {
      for (const listener of listeners.get(type) ?? []) {
        listener({ persisted } as PageTransitionEvent);
      }
    },
    listenerCount() {
      return [...listeners.values()].reduce((sum, registered) => sum + registered.size, 0);
    },
  };
}
