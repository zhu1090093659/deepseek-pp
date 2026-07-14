export interface RequestGenerationFence {
  begin(): number;
  isCurrent(generation: number): boolean;
  invalidate(): void;
}

export function createRequestGenerationFence(): RequestGenerationFence {
  let currentGeneration = 0;
  return Object.freeze({
    begin() {
      currentGeneration += 1;
      return currentGeneration;
    },
    isCurrent(generation: number) {
      return generation === currentGeneration;
    },
    invalidate() {
      currentGeneration += 1;
    },
  });
}

export type AsyncState<T> =
  | { status: 'idle'; value: T; error: null }
  | { status: 'loading'; value: T; error: null }
  | { status: 'ready'; value: T; error: null }
  | { status: 'error'; value: T; error: Error };

export function idleAsyncState<T>(value: T): AsyncState<T> {
  return { status: 'idle', value, error: null };
}

export function loadingAsyncState<T>(state: AsyncState<T>): AsyncState<T> {
  return { status: 'loading', value: state.value, error: null };
}

export function readyAsyncState<T>(value: T): AsyncState<T> {
  return { status: 'ready', value, error: null };
}

export function failedAsyncState<T>(state: AsyncState<T>, error: unknown): AsyncState<T> {
  return {
    status: 'error',
    value: state.value,
    error: error instanceof Error ? error : new Error(String(error)),
  };
}
