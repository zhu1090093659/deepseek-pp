import { describe, expect, it, vi } from 'vitest';
import { createContentChatController } from '../entrypoints/content/controllers/chat-controller';
import { createContentLifecycleKernel } from '../entrypoints/content/lifecycle';

describe('Content chat controller', () => {
  it('gates ingress by lifecycle and waits for active dispatch during stop', async () => {
    let releaseDispatch!: () => void;
    const dispatch = vi.fn(() => new Promise<void>((resolve) => {
      releaseDispatch = resolve;
    }));
    const controller = createContentChatController({ dispatch });
    const kernel = createContentLifecycleKernel([controller]);

    await controller.handle({ type: 'BEFORE_START' });
    expect(dispatch).not.toHaveBeenCalled();

    await kernel.start();
    const activeDispatch = controller.handle({ type: 'ACTIVE' });
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledOnce();

    let stopped = false;
    const stopping = kernel.stop('reinjection').then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    releaseDispatch();
    await activeDispatch;
    await stopping;
    await controller.handle({ type: 'AFTER_STOP' });

    expect(dispatch).toHaveBeenCalledOnce();
    expect(kernel.snapshot().resources.total).toBe(0);
  });
});
