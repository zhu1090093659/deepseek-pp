import { installFetchHook } from '../../../core/interceptor/fetch-hook';
import type {
  ContentCapabilityController,
  ContentLifecycleStopReason,
} from '../lifecycle';

export function createMainWorldInterceptorController(
  install: () => () => void = installFetchHook,
): ContentCapabilityController {
  let uninstall: (() => void) | null = null;

  return {
    id: 'main-world-interceptor',
    start() {
      if (uninstall) return;
      uninstall = install();
    },
    stop(_reason: ContentLifecycleStopReason) {
      uninstall?.();
      uninstall = null;
    },
  };
}
