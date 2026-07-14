import type { ContentResourceScope } from '../lifecycle';

export interface ContentMutationSubscription {
  readonly matches: (mutations: readonly MutationRecord[]) => boolean;
  readonly handle: (mutations: readonly MutationRecord[]) => void;
}

export interface ContentMutationHubSnapshot {
  readonly deliveries: number;
  readonly subscriberCallbacks: number;
  readonly subscribers: number;
}

export interface ContentMutationHub {
  start(scope: ContentResourceScope): void;
  stop(): void;
  subscribe(subscription: ContentMutationSubscription): () => void;
  snapshot(): ContentMutationHubSnapshot;
}

export function createContentMutationHub(options: {
  readonly document?: Document;
  readonly createObserver?: (callback: MutationCallback) => MutationObserver;
  readonly reportError: (error: unknown) => void;
}): ContentMutationHub {
  const targetDocument = options.document ?? document;
  const createObserver = options.createObserver ?? ((callback) => new MutationObserver(callback));
  const subscriptions = new Set<ContentMutationSubscription>();
  let activeScope: ContentResourceScope | null = null;
  let deliveries = 0;
  let subscriberCallbacks = 0;

  return {
    start(scope) {
      activeScope = scope;
      deliveries = 0;
      subscriberCallbacks = 0;
      const root = targetDocument.getElementById('root') ?? targetDocument.body;
      if (!root) throw new Error('Content mutation root is unavailable.');
      const observer = createObserver((mutations) => {
        if (activeScope !== scope || !scope.active) return;
        deliveries += 1;
        for (const subscription of [...subscriptions]) {
          try {
            if (!subscription.matches(mutations)) continue;
            subscriberCallbacks += 1;
            subscription.handle(mutations);
          } catch (error) {
            options.reportError(error);
          }
        }
      });
      scope.observe(observer, root, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    },
    stop() {
      activeScope = null;
      subscriptions.clear();
    },
    subscribe(subscription) {
      if (!activeScope?.active) {
        throw new Error('Content mutation hub is not running.');
      }
      subscriptions.add(subscription);
      return () => subscriptions.delete(subscription);
    },
    snapshot() {
      return Object.freeze({
        deliveries,
        subscriberCallbacks,
        subscribers: subscriptions.size,
      });
    },
  };
}
