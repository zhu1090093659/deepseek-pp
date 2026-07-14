import { isExpectedMissingRuntimeMessageReceiverError } from '../../core/messaging/broadcast';

export interface DeepSeekAuthRefreshTab {
  readonly id?: number | null;
}

export interface DeepSeekAuthRefreshDependencies {
  readonly sendMessage: (tabId: number) => Promise<unknown>;
  readonly reportError: (code: string, error: unknown) => void;
}

export async function refreshDeepSeekAuthFromTabs(
  tabs: readonly DeepSeekAuthRefreshTab[],
  dependencies: DeepSeekAuthRefreshDependencies,
): Promise<boolean> {
  const unexpectedErrors: unknown[] = [];
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      const response = await dependencies.sendMessage(tab.id);
      if (hasAuthToken(response)) return true;
    } catch (error) {
      if (isExpectedMissingRuntimeMessageReceiverError(error)) continue;
      unexpectedErrors.push(error);
      dependencies.reportError('auth_refresh_tab_delivery_failed', error);
    }
  }

  if (unexpectedErrors.length > 0) {
    throw new AggregateError(
      unexpectedErrors,
      'DeepSeek auth refresh failed for every reachable tab.',
    );
  }
  return false;
}

function hasAuthToken(value: unknown): boolean {
  return Boolean(
    value
    && typeof value === 'object'
    && (value as { hasToken?: unknown }).hasToken === true,
  );
}
