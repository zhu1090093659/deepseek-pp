export class DeepSeekAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeepSeekAuthError';
  }
}

export class DeepSeekPowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeepSeekPowError';
  }
}

export class DeepSeekSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeepSeekSessionError';
  }
}

export class DeepSeekPayloadError extends Error {
  readonly retryable: boolean;

  constructor(message: string, options?: { retryable?: boolean }) {
    super(message);
    this.name = 'DeepSeekPayloadError';
    this.retryable = options?.retryable ?? false;
  }
}
