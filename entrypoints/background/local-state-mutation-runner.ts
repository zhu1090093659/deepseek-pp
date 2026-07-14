import type {
  LocalStateMutationRunner,
  LocalStateMutationStage,
} from '../../core/persistence/local-state-mutation';

export interface TrackedLocalStateMutationDependencies {
  runWithRecovery<T>(stage: LocalStateMutationStage<T>): Promise<T>;
  trackApply<T>(operation: Promise<T>): Promise<T>;
}

export function createTrackedLocalStateMutationRunner(
  dependencies: TrackedLocalStateMutationDependencies,
): LocalStateMutationRunner['runLocalStateMutation'] {
  return <T>(stage: LocalStateMutationStage<T>) => (
    dependencies.trackApply(dependencies.runWithRecovery(stage))
  );
}
