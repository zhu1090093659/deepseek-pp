import type { ToolResult } from '../tool/types';

export type BackgroundErrorResponse = ToolResult | { ok: false; error: string } | null;

export function createBackgroundErrorResponse(
  message: { type?: string } | unknown,
  error: unknown,
  toolFailureSummary: string,
): BackgroundErrorResponse {
  const detail = error instanceof Error ? error.message : String(error);

  if (!message || typeof message !== 'object') {
    return null;
  }

  const type = (message as { type?: string }).type;
  if (type === 'EXECUTE_TOOL_CALL') {
    return {
      ok: false,
      summary: toolFailureSummary,
      detail,
      error: {
        code: 'background_tool_execution_failed',
        message: detail,
        retryable: true,
      },
    };
  }

  return { ok: false, error: detail };
}
