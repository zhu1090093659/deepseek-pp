import { describe, expect, it, vi } from 'vitest';
import { createMainWorldInterceptorController } from '../entrypoints/content/controllers/main-world-interceptor-controller';
import { createContentLifecycleKernel } from '../entrypoints/content/lifecycle';

describe('MAIN-world interceptor controller', () => {
  it('owns one reversible hook installation per lifecycle epoch', async () => {
    const uninstall = vi.fn();
    const install = vi.fn(() => uninstall);
    const kernel = createContentLifecycleKernel([
      createMainWorldInterceptorController(install),
    ]);

    await kernel.start();
    await kernel.start();
    expect(install).toHaveBeenCalledOnce();

    await kernel.stop('reinjection');
    await kernel.stop('manual');
    expect(uninstall).toHaveBeenCalledOnce();
    expect(kernel.snapshot().resources.total).toBe(0);

    await kernel.start();
    await kernel.stop('pagehide');
    expect(install).toHaveBeenCalledTimes(2);
    expect(uninstall).toHaveBeenCalledTimes(2);
  });
});
