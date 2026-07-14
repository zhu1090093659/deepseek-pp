import {
  pendingChatTextStore,
  type PendingChatTextStore,
} from '../../../core/chat/pending-text';

export type PendingTextConsumerOperation = 'read' | 'watch' | 'clear';

export interface PendingTextConsumer {
  stop(): void;
}

export function startPendingTextConsumer(options: {
  onText(text: string): void;
  onError(operation: PendingTextConsumerOperation, error: unknown): void;
  store?: PendingChatTextStore;
}): PendingTextConsumer {
  const store = options.store ?? pendingChatTextStore;
  let stopped = false;
  let observedText: string | null = null;
  let storageGeneration = 0;

  const consume = (text: string | null) => {
    if (stopped) return;
    if (text === null) {
      observedText = null;
      return;
    }
    if (text === observedText) return;
    observedText = text;
    options.onText(text);
    void store.clear().catch((error) => {
      if (!stopped) options.onError('clear', error);
    });
  };

  const unsubscribe = store.subscribe(
    (text) => {
      storageGeneration += 1;
      consume(text);
    },
    (error) => {
      storageGeneration += 1;
      if (!stopped) options.onError('watch', error);
    },
  );
  const readGeneration = storageGeneration;
  void store.read().then((text) => {
    if (storageGeneration === readGeneration) consume(text);
  }).catch((error) => {
    if (!stopped) options.onError('read', error);
  });

  return Object.freeze({
    stop() {
      if (stopped) return;
      stopped = true;
      unsubscribe();
    },
  });
}
