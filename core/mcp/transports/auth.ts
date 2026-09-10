import { buildMcpRequestHeaders } from '../store';
import {
  invalidateMcpOAuthToken,
  isMcpOAuthEnabled,
  resolveMcpOAuthAuthorization,
} from '../oauth-client';
import type { McpServerConfig } from '../types';

/**
 * Static secret headers plus, when the server uses OAuth, the resolved
 * Authorization header. OAuth owns `Authorization` for its server so a
 * configured static bearer secret cannot silently shadow it.
 *
 * Transport callers pass interactive=false: an unauthenticated request must
 * fail with `mcp_oauth_authorization_required` rather than open a browser
 * popup from a background discovery or tool call.
 */
export async function resolveMcpRequestHeaders(
  server: McpServerConfig,
  options: { interactive?: boolean; signal?: AbortSignal } = {},
): Promise<Record<string, string>> {
  const headers = buildMcpRequestHeaders(server);
  if (!isMcpOAuthEnabled(server)) return headers;
  const authorization = await resolveMcpOAuthAuthorization(server, {
    interactive: options.interactive ?? false,
    signal: options.signal,
  });
  if (authorization) headers.Authorization = authorization;
  return headers;
}

/**
 * Drop the cached access token after a 401 so the next attempt refreshes.
 * Returns true when a retry is worth attempting.
 */
export function shouldRetryMcpUnauthorized(server: McpServerConfig, status: number): boolean {
  if (status !== 401 || !isMcpOAuthEnabled(server)) return false;
  invalidateMcpOAuthToken(server.id);
  return true;
}
