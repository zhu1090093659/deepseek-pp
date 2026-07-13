export function createMcpDescriptorId(serverId: string, toolName: string): string {
  return `mcp:${serverId}:${toolName}`;
}

export function createMcpInvocationName(serverId: string, toolName: string): string {
  return `mcp_${sanitizeMcpInvocationPart(serverId)}_${sanitizeMcpInvocationPart(toolName)}`.slice(0, 96);
}

function sanitizeMcpInvocationPart(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  const safe = normalized || 'tool';
  return /^[A-Za-z_]/.test(safe) ? safe : `t_${safe}`;
}
