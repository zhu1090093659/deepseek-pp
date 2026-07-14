export interface ContentAuthStatusNotifierDependencies {
  readonly send: () => Promise<unknown>;
  readonly isExtensionInvalidatedError: (error: unknown) => boolean;
  readonly invalidateExtensionContext: () => void;
  readonly reportError: (error: unknown) => void;
}

/**
 * Notify extension consumers after captured DeepSeek credentials are persisted.
 * A stale extension context owns its normal teardown path; every other transport
 * failure is surfaced at this content boundary instead of being silently ignored.
 */
export async function notifyContentAuthStatusChanged(
  dependencies: ContentAuthStatusNotifierDependencies,
): Promise<boolean> {
  try {
    await dependencies.send();
    return true;
  } catch (error) {
    if (dependencies.isExtensionInvalidatedError(error)) {
      dependencies.invalidateExtensionContext();
    } else {
      dependencies.reportError(error);
    }
    return false;
  }
}
