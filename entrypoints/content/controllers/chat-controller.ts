import type {
  ContentCapabilityController,
  ContentLifecycleStopReason,
  ContentResourceScope,
} from '../lifecycle';

export interface ContentChatController extends ContentCapabilityController {
  handle(message: Record<string, unknown>): Promise<void>;
}

export function createContentChatController(dependencies: {
  readonly dispatch: (message: Record<string, unknown>) => void | Promise<void>;
}): ContentChatController {
  let scope: ContentResourceScope | null = null;
  const pendingDispatches = new Set<Promise<void>>();

  return {
    id: 'chat-runtime',
    start(nextScope) {
      scope = nextScope;
    },
    async stop(_reason: ContentLifecycleStopReason) {
      scope = null;
      while (pendingDispatches.size > 0) {
        await Promise.allSettled([...pendingDispatches]);
      }
    },
    async handle(message) {
      if (!scope?.active) return;
      const task = Promise.resolve().then(() => dependencies.dispatch(message));
      pendingDispatches.add(task);
      try {
        await task;
      } finally {
        pendingDispatches.delete(task);
      }
    },
  };
}
