import {
  authorizeMcpServer as runInteractiveAuthorization,
  getMcpOAuthStatus,
  invalidateMcpOAuthToken,
  type McpOAuthStatus,
} from './oauth-client';
import { getMcpServerById, updateMcpServer } from './store';
import type { McpServerId } from './types';

/**
 * Background-owned orchestration for MCP OAuth.
 *
 * The interactive flow itself lives in oauth-client; this layer owns the
 * durable side effect: persisting the returned refresh token onto the server
 * config exactly once, and clearing it on disconnect. Callers in the Side
 * Panel only ever see the resulting status.
 */

export async function getMcpOAuthStatusForServer(
  serverId: McpServerId,
): Promise<McpOAuthStatus | null> {
  const server = await getMcpServerById(serverId, { includeSecrets: true });
  if (!server) return null;
  return getMcpOAuthStatus(server);
}

export async function authorizeMcpOAuthServer(
  serverId: McpServerId,
): Promise<{ ok: true; status: McpOAuthStatus } | { ok: false; error: string }> {
  const server = await getMcpServerById(serverId, { includeSecrets: true });
  if (!server) return { ok: false, error: 'mcp_server_not_found' };
  if (!server.oauth?.enabled) return { ok: false, error: 'mcp_oauth_not_configured' };

  try {
    const token = await runInteractiveAuthorization(server);
    // Persist the refresh token *and* the endpoints / client id discovered
    // during the flow, so a later refresh survives an idle service worker.
    const saved = await updateMcpServer(serverId, {
      oauth: {
        ...server.oauth,
        ...token.oauthPatch,
        ...(token.refreshToken ? { refreshToken: token.refreshToken } : {}),
      },
    });
    if (!saved) return { ok: false, error: 'mcp_server_not_found' };
    // updateMcpServer returns a sanitized config (refresh token replaced by
    // the redaction placeholder). Read the secrets-included copy so the status
    // reflects the refresh token we just stored instead of reporting the
    // server as unauthorized right after a successful consent.
    const persisted = await getMcpServerById(serverId, { includeSecrets: true });
    return { ok: true, status: getMcpOAuthStatus(persisted ?? saved) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function disconnectMcpOAuthServer(serverId: McpServerId): Promise<{ ok: true }> {
  invalidateMcpOAuthToken(serverId);
  const server = await getMcpServerById(serverId, { includeSecrets: true });
  if (server?.oauth?.refreshToken) {
    await updateMcpServer(serverId, {
      oauth: { ...server.oauth, refreshToken: undefined },
    });
  }
  return { ok: true };
}
