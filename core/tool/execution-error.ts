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
