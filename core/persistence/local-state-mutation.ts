export type LocalStateMutationStage<T> = () => Promise<() => Promise<T>>;

export interface LocalStateMutationRunner {
  runLocalStateMutation<T>(stage: LocalStateMutationStage<T>): Promise<T>;
}
