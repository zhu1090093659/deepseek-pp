export function unwrapRuntimeResponse<T>(response: unknown, missingMessage: string): T {
  if (isRuntimeFailure(response)) throwRuntimeFailure(response, missingMessage);
  if (response === null || response === undefined) throw new Error(missingMessage);
  return response as T;
}

export function decodeRuntimeResponse<T>(
  response: unknown,
  decode: (value: unknown) => T,
  missingMessage: string,
): T {
  if (response === undefined) throw new Error(missingMessage);
  try {
    return decode(response);
  } catch (decodeError) {
    if (isRuntimeFailure(response)) throwRuntimeFailure(response, missingMessage);
    throw decodeError;
  }
}

export function isRuntimeFailure(response: unknown): response is { ok: false; error?: unknown } {
  return Boolean(
    response &&
    typeof response === 'object' &&
    (response as { ok?: unknown }).ok === false,
  );
}

export function getRuntimeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function throwRuntimeFailure(
  response: { ok: false; error?: unknown },
  missingMessage: string,
): never {
  throw new Error(response.error ? String(response.error) : missingMessage);
}
