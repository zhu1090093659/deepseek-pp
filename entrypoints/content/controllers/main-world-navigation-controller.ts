import type {
  ContentCapabilityController,
  ContentLifecycleStopReason,
  ContentResourceScope,
} from '../lifecycle';

const PUSH_STATE_MARKER = Symbol.for('deepseek-pp.navigation-push-state');
const REPLACE_STATE_MARKER = Symbol.for('deepseek-pp.navigation-replace-state');

type MarkedPushState = History['pushState'] & { [PUSH_STATE_MARKER]?: true };
type MarkedReplaceState = History['replaceState'] & { [REPLACE_STATE_MARKER]?: true };

export function createMainWorldNavigationController(options: {
  readonly target?: Window;
  readonly onNavigate: () => void;
}): ContentCapabilityController {
  const target = options.target ?? window;
  let scope: ContentResourceScope | null = null;

  const notify = () => {
    if (scope?.active) options.onNavigate();
  };

  return {
    id: 'navigation-runtime',
    start(nextScope) {
      scope = nextScope;
      const historyValue = target.history;
      const originalPushState = historyValue.pushState;
      const originalReplaceState = historyValue.replaceState;
      if (
        (originalPushState as MarkedPushState)[PUSH_STATE_MARKER]
        || (originalReplaceState as MarkedReplaceState)[REPLACE_STATE_MARKER]
      ) {
        throw new Error('MAIN-world navigation history boundary is already owned.');
      }

      const patchedPushState: History['pushState'] = function patchedPushState(
        this: History,
        ...args: Parameters<History['pushState']>
      ) {
        const result = originalPushState.apply(this, args);
        notify();
        return result;
      };
      const patchedReplaceState: History['replaceState'] = function patchedReplaceState(
        this: History,
        ...args: Parameters<History['replaceState']>
      ) {
        const result = originalReplaceState.apply(this, args);
        notify();
        return result;
      };
      Object.defineProperty(patchedPushState, PUSH_STATE_MARKER, { value: true });
      Object.defineProperty(patchedReplaceState, REPLACE_STATE_MARKER, { value: true });
      historyValue.pushState = patchedPushState;
      historyValue.replaceState = patchedReplaceState;

      nextScope.listen(target, 'popstate', notify);
      nextScope.listen(target, 'hashchange', notify);
      nextScope.addCleanup('cleanup', () => {
        if (historyValue.pushState === patchedPushState) historyValue.pushState = originalPushState;
        if (historyValue.replaceState === patchedReplaceState) {
          historyValue.replaceState = originalReplaceState;
        }
      });
    },
    stop(_reason: ContentLifecycleStopReason) {
      scope = null;
    },
  };
}
