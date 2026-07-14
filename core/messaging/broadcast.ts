export interface RuntimeBroadcastTab {
  id?: number | null;
}

export interface RuntimeBroadcastDependencies {
  tabUrlPattern: string;
  sendRuntimeMessage(payload: Record<string, unknown>): Promise<unknown>;
  queryTabsByUrl(urlPattern: string): Promise<readonly RuntimeBroadcastTab[]>;
  sendTabMessage(tabId: number, payload: Record<string, unknown>): Promise<unknown>;
  reportError(code: string, error: unknown): void;
}

export async function broadcastRuntimeUpdate(
  payload: Record<string, unknown>,
  excludeTabId: number | undefined,
  dependencies: RuntimeBroadcastDependencies,
): Promise<void> {
  deliverBestEffort(
    dependencies.sendRuntimeMessage(payload),
    'broadcast_runtime_delivery_failed',
    dependencies,
  );

  let tabs: readonly RuntimeBroadcastTab[] = [];
  try {
    tabs = await dependencies.queryTabsByUrl(dependencies.tabUrlPattern);
  } catch (error) {
    dependencies.reportError('broadcast_tabs_query_failed', error);
    if (excludeTabId) {
      deliverBestEffort(
        dependencies.sendTabMessage(excludeTabId, payload),
        'broadcast_tab_delivery_failed',
        dependencies,
      );
    }
    return;
  }

  for (const tab of tabs) {
    if (tab.id && tab.id !== excludeTabId) {
      deliverBestEffort(
        dependencies.sendTabMessage(tab.id, payload),
        'broadcast_tab_delivery_failed',
        dependencies,
      );
    }
  }
  if (excludeTabId) {
    deliverBestEffort(
      dependencies.sendTabMessage(excludeTabId, payload),
      'broadcast_tab_delivery_failed',
      dependencies,
    );
  }
}

function deliverBestEffort(
  delivery: Promise<unknown>,
  errorCode: string,
  dependencies: Pick<RuntimeBroadcastDependencies, 'reportError'>,
): void {
  void delivery.catch((error) => {
    if (isExpectedMissingRuntimeMessageReceiverError(error)) return;
    dependencies.reportError(errorCode, error);
  });
}

export function isExpectedMissingRuntimeMessageReceiverError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return [
    'Receiving end does not exist',
    'The message port closed before a response was received',
    'No tab with id',
  ].some((fragment) => message.includes(fragment));
}
