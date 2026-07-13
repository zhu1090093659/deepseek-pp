import {
  definePayloadlessRuntimeCommandHandler,
  type RuntimeCommandHandler,
} from '../../core/messaging/runtime-command-registry';

export interface BootstrapRuntimeHandlerDependencies {
  getVersion(): string;
  dismissWhatsNew(): Promise<void>;
  refreshWhatsNewBadge(): Promise<void>;
}

export function createBootstrapRuntimeHandlers(
  dependencies: BootstrapRuntimeHandlerDependencies,
): readonly RuntimeCommandHandler[] {
  return Object.freeze([
    definePayloadlessRuntimeCommandHandler('GET_CONFIG', () => ({
      version: dependencies.getVersion(),
    })),
    definePayloadlessRuntimeCommandHandler('WHATS_NEW_DISMISSED', async () => {
      await dependencies.dismissWhatsNew();
      await dependencies.refreshWhatsNewBadge();
      return { ok: true as const };
    }),
  ]);
}
