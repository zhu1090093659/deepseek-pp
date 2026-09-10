import type { McpServerResultLimits, McpServerTimeouts } from './types';

export const MCP_PROTOCOL_VERSION = '2025-06-18';

// MCP servers negotiate the version they actually implement during initialize.
// Keep released historical versions explicit so an older server does not get
// turned into an empty discovery cache, while unknown/future versions remain
// fail-closed in the client.
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = [
  '2024-11-05',
  '2025-03-26',
  MCP_PROTOCOL_VERSION,
] as const;

export const MCP_DEFAULT_TIMEOUTS: McpServerTimeouts = {
  connectMs: 10_000,
  requestMs: 60_000,
  discoveryMs: 20_000,
};

export const MCP_DEFAULT_LIMITS: McpServerResultLimits = {
  maxResultBytes: 64_000,
  maxToolCount: 128,
};

/**
 * Placeholder written in place of a secret on sanitized reads that omit
 * `includeSecrets`. It is never a real credential: consumers must treat it as
 * "no value" so a redacted refresh token or client secret cannot be sent to a
 * token endpoint or mistaken for a stored authorization.
 */
export const MCP_REDACTED_SECRET_VALUE = '********';

/** True when a secret field holds the redaction placeholder rather than a value. */
export function isMcpRedactedSecret(value: string | undefined | null): boolean {
  return value === MCP_REDACTED_SECRET_VALUE;
}

/** True when a secret field holds a usable, non-placeholder value. */
export function hasRealMcpSecret(value: string | undefined | null): value is string {
  return typeof value === 'string' && value.length > 0 && value !== MCP_REDACTED_SECRET_VALUE;
}
