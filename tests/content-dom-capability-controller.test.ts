import { describe, expect, it, vi } from 'vitest';
import { createDomCapabilityController } from '../entrypoints/content/controllers/dom-capability-controller';
import { createContentLifecycleKernel } from '../entrypoints/content/lifecycle';

describe('Content DOM capability controller', () => {
  it('starts once after DOM readiness and tears down once with zero resources', async () => {
    const target = createFakeDocument('loading');
    const start = vi.fn();
    const stop = vi.fn();
    const controller = createDomCapabilityController({
      id: 'dom-test',
      document: target.document,
      start,
      stop,
      reportError: vi.fn(),
    });
    const kernel = createContentLifecycleKernel([controller]);

    await kernel.start();
    expect(start).not.toHaveBeenCalled();
    expect(kernel.snapshot().resources.byKind.listener).toBe(1);

    target.setReadyState('interactive');
    target.document.dispatchEvent(new Event('DOMContentLoaded'));
    await Promise.resolve();
    expect(start).toHaveBeenCalledOnce();
    expect(kernel.snapshot().resources.byKind.listener).toBe(0);
    expect(kernel.snapshot().resources.byKind.cleanup).toBe(1);

    await kernel.stop('pagehide');
    await kernel.stop('manual');
    expect(stop).toHaveBeenCalledOnce();
    expect(kernel.snapshot().resources.total).toBe(0);
  });

  it('does not start after teardown wins the DOM-ready race', async () => {
    const target = createFakeDocument('loading');
    const start = vi.fn();
    const controller = createDomCapabilityController({
      id: 'dom-race',
      document: target.document,
      start,
      stop: vi.fn(),
      reportError: vi.fn(),
    });
    const kernel = createContentLifecycleKernel([controller]);

    await kernel.start();
    await kernel.stop('reinjection');
    target.document.dispatchEvent(new Event('DOMContentLoaded'));
    await Promise.resolve();

    expect(start).not.toHaveBeenCalled();
    expect(kernel.snapshot().resources.total).toBe(0);
  });

  it('reports a deferred DOM startup failure exactly once and still tears down', async () => {
    const target = createFakeDocument('loading');
    const failure = new Error('deferred start failed');
    const reportError = vi.fn();
    const stop = vi.fn();
    const controller = createDomCapabilityController({
      id: 'dom-deferred-failure',
      document: target.document,
      start: vi.fn(async () => { throw failure; }),
      stop,
      reportError,
    });
    const kernel = createContentLifecycleKernel([controller]);
    await kernel.start();

    target.setReadyState('interactive');
    target.document.dispatchEvent(new Event('DOMContentLoaded'));
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledOnce());
    expect(reportError).toHaveBeenCalledWith(failure);

    await kernel.stop('manual');
    expect(stop).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledOnce();
    expect(kernel.snapshot().resources.total).toBe(0);
  });

  it('returns an immediate DOM startup failure to the lifecycle kernel without duplicate reporting', async () => {
    const target = createFakeDocument('interactive');
    const failure = new Error('immediate start failed');
    const reportError = vi.fn();
    const stop = vi.fn();
    const controller = createDomCapabilityController({
      id: 'dom-immediate-failure',
      document: target.document,
      start: vi.fn(async () => { throw failure; }),
      stop,
      reportError,
    });
    const kernel = createContentLifecycleKernel([controller]);

    await expect(kernel.start()).rejects.toBe(failure);
    expect(reportError).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledOnce();
    expect(kernel.snapshot().resources.total).toBe(0);
  });
});

function createFakeDocument(initialReadyState: DocumentReadyState): {
  document: Document;
  setReadyState(value: DocumentReadyState): void;
} {
  let readyState = initialReadyState;
  const target = new EventTarget();
  Object.defineProperty(target, 'readyState', { get: () => readyState });
  return {
    document: target as unknown as Document,
    setReadyState(value) {
      readyState = value;
    },
  };
}
