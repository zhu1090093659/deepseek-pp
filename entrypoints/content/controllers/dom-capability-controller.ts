import type {
  ContentCapabilityController,
  ContentLifecycleStopReason,
  ContentResourceRelease,
  ContentResourceScope,
} from '../lifecycle';

export interface DomCapabilityControllerDependencies {
  readonly id: string;
  readonly document?: Document;
  readonly start: (scope: ContentResourceScope, epoch: number) => void | Promise<void>;
  readonly stop: (reason: ContentLifecycleStopReason) => void | Promise<void>;
  readonly reportError: (error: unknown) => void;
}

export function createDomCapabilityController(
  dependencies: DomCapabilityControllerDependencies,
): ContentCapabilityController {
  const targetDocument = dependencies.document ?? document;
  let activeScope: ContentResourceScope | null = null;
  let activeEpoch = 0;
  let started = false;
  let startTask: Promise<void> | null = null;
  let stopTask: Promise<void> | null = null;
  let releaseReadyListener: ContentResourceRelease | null = null;
  let releaseCapabilityLease: ContentResourceRelease | null = null;
  let startFailureOwner: 'lifecycle' | 'deferred-reporter' | null = null;

  const begin = (
    scope: ContentResourceScope,
    epoch: number,
    failureOwner: 'lifecycle' | 'deferred-reporter',
  ): Promise<void> => {
    if (activeScope !== scope || activeEpoch !== epoch || !scope.active || started) {
      return Promise.resolve();
    }
    started = true;
    startFailureOwner = failureOwner;
    releaseCapabilityLease = scope.addCleanup('cleanup', () => undefined);
    startTask = Promise.resolve().then(() => dependencies.start(scope, epoch));
    return startTask;
  };

  const stop = (reason: ContentLifecycleStopReason): Promise<void> => {
    if (stopTask) return stopTask;
    const task = startTask;
    const shouldStop = started;
    const releaseReady = releaseReadyListener;
    const releaseLease = releaseCapabilityLease;
    activeScope = null;
    releaseReadyListener = null;
    stopTask = (async () => {
      const errors: unknown[] = [];
      if (releaseReady) {
        try {
          await releaseReady();
        } catch (error) {
          errors.push(error);
        }
      }
      if (task) {
        const [settlement] = await Promise.allSettled([task]);
        if (settlement.status === 'rejected' && startFailureOwner === null) {
          errors.push(settlement.reason);
        }
        // Immediate failures are returned to the lifecycle kernel; deferred
        // failures are reported by onReady below. Stop only waits for settlement.
      }
      if (shouldStop) {
        try {
          await dependencies.stop(reason);
        } catch (error) {
          errors.push(error);
        }
      }
      if (releaseLease) {
        try {
          await releaseLease();
        } catch (error) {
          errors.push(error);
        }
      }
      releaseCapabilityLease = null;
      started = false;
      startTask = null;
      startFailureOwner = null;
      if (errors.length > 0) {
        throw new AggregateError(errors, `DOM capability teardown failed: ${dependencies.id}.`);
      }
    })();
    return stopTask;
  };

  return {
    id: dependencies.id,
    start(scope, epoch) {
      activeScope = scope;
      activeEpoch = epoch;
      started = false;
      startTask = null;
      stopTask = null;
      releaseCapabilityLease = null;
      startFailureOwner = null;

      if (targetDocument.readyState === 'complete' || targetDocument.readyState === 'interactive') {
        return begin(scope, epoch, 'lifecycle');
      }

      const onReady = () => {
        const releaseReady = releaseReadyListener;
        releaseReadyListener = null;
        if (releaseReady) void releaseReady().catch(dependencies.reportError);
        void begin(scope, epoch, 'deferred-reporter').catch(dependencies.reportError);
      };
      releaseReadyListener = scope.listen(targetDocument, 'DOMContentLoaded', onReady, { once: true });
    },
    stop,
  };
}
