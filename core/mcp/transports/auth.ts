import { buildMcpRequestHeaders, updateMcpServer } from '../store';
import {
  invalidateMcpOAuthToken,
  isMcpOAuthEnabled,
  resolveMcpOAuthAuthorization,
} from '../oauth-client';
import type { McpServerConfig } from '../types';
import { hasRealMcpSecret } from '../constants';

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
    // A rotated refresh token must be written back to storage. The in-memory
    // cache is dropped when the MV3 service worker idles, so an unpersisted
    // rotation leaves a consumed token behind and the next refresh fails with
    // invalid_grant.
    onRefreshTokenRotated: async (refreshToken) => {
      await updateMcpServer(server.id, {
        oauth: { ...(server.oauth ?? { enabled: true }), refreshToken },
      });
    },
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

/**
 * Human-readable OAuth state for a failed authenticated MCP request.
 *
 * A 401 that survives the token-refresh retry means the Authorization header
 * was attached but the resource server rejected the token (audience/resource
 * mismatch, revoked grant, wrong client). Without this snapshot the caller
 * only sees a bare HTTP 401 and cannot tell that apart from "no header at all".
 */
export function describeMcpOAuthFailure(server: McpServerConfig): string {
  return [
    `oauthEnabled=${isMcpOAuthEnabled(server)}`,
    `hasRefreshToken=${hasRealMcpSecret(server.oauth?.refreshToken)}`,
    `tokenUrl=${server.oauth?.tokenUrl ? 'set' : 'unset'}`,
    `authorizationUrl=${server.oauth?.authorizationUrl ? 'set' : 'unset'}`,
    `clientId=${server.oauth?.clientId ? 'set' : 'UNSET (refresh would re-register a new client)'}`,
    `scopes=${(server.oauth?.scopes ?? []).length}`,
    `resource=${server.oauth?.resource ?? '(unset)'}`,
  ].join(', ');
}
