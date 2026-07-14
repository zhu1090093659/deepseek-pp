export function readOptionalChromeApi<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch (error) {
    if (isKnownUnavailableChromeApiError(error)) return undefined;
    throw error;
  }
}

function isKnownUnavailableChromeApiError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('is not allowed for specified extension ID') ||
    message.includes('Extension context invalidated') ||
    message.includes('context invalidated');
}
