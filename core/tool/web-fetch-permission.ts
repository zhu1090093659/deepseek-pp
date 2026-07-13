import type { ToolCall, ToolResult } from './types';

export const WEB_FETCH_DESCRIPTOR_ID = 'local:web:web_fetch';
export const WEB_FETCH_PERMISSION_ERROR_CODE = 'fetch_permission_denied';

export function isRetryableWebFetchPermissionPrecondition(
  descriptorId: string,
  result?: Pick<ToolResult, 'ok' | 'error'>,
): boolean {
  return descriptorId === WEB_FETCH_DESCRIPTOR_ID &&
    result?.ok === false &&
    result.error?.code === WEB_FETCH_PERMISSION_ERROR_CODE;
}

export function shouldRequestWebFetchPermission(
  call: Pick<ToolCall, 'descriptorId' | 'provider' | 'name' | 'invocationName'>,
  result: Pick<ToolResult, 'ok' | 'error'>,
): boolean {
  return isRetryableWebFetchPermissionPrecondition(call.descriptorId ?? '', result) &&
    call.name === 'web_fetch' &&
    call.invocationName === 'web_fetch' &&
    call.provider?.kind === 'local' &&
    call.provider.id === 'web' &&
    call.provider.transport === 'in_process';
}
