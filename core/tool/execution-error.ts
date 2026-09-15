export const INCOMPLETE_TOOL_CALL_ERROR_CODE = 'tool_call_incomplete';

// A tool call whose closing tag is missing but whose block is bounded by a
// foreign terminator (another tool's closing tag, a legacy `</｜DSML｜invoke>` /
// `</invoke>`, or the next known open tag). Recovered as a parseError record so
// the loop sees the call and fails visibly instead of silently dropping it.
export const MISMATCHED_TOOL_CALL_ERROR_CODE = 'tool_call_close_mismatched';

export class ToolPostEffectPersistenceError extends Error {
  readonly code = 'tool_post_effect_persistence_failed' as const;
  readonly retryable = false as const;
  readonly externalOutcome = 'ambiguous' as const;

  constructor(readonly originalError: unknown) {
    const detail = originalError instanceof Error ? originalError.message : String(originalError);
    super(
      'The tool provider may have completed, but execution history could not be persisted. '
      + `Do not retry automatically: ${detail}`,
    );
    this.name = 'ToolPostEffectPersistenceError';
  }
}
