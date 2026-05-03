import { TOOL_CALLS_BLOCK_REGEX, INVOKE_REGEX, PARAMETER_REGEX } from '../constants';
import type { ToolCall } from '../types';

export function extractToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const blockRegex = new RegExp(TOOL_CALLS_BLOCK_REGEX.source, 'g');
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = blockRegex.exec(text)) !== null) {
    const blockContent = blockMatch[0];
    const invokeRegex = new RegExp(INVOKE_REGEX.source, 'g');
    let invokeMatch: RegExpExecArray | null;

    while ((invokeMatch = invokeRegex.exec(blockContent)) !== null) {
      const name = invokeMatch[1];
      const invokeContent = invokeMatch[2];
      const payload: Record<string, unknown> = {};
      const paramRegex = new RegExp(PARAMETER_REGEX.source, 'g');
      let paramMatch: RegExpExecArray | null;

      while ((paramMatch = paramRegex.exec(invokeContent)) !== null) {
        const paramName = paramMatch[1];
        const isString = paramMatch[2] === 'true';
        const value = paramMatch[3];
        if (isString) {
          payload[paramName] = value;
        } else {
          try {
            payload[paramName] = JSON.parse(value);
          } catch {
            payload[paramName] = value;
          }
        }
      }

      calls.push({ name, payload, raw: blockMatch[0] });
    }
  }

  return calls;
}

export function stripToolCalls(text: string): string {
  const regex = new RegExp(TOOL_CALLS_BLOCK_REGEX.source, 'g');
  return text.replace(regex, '').trim();
}
