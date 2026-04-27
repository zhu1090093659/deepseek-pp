import { TOOL_CALL_REGEX } from '../constants';
import type { ToolCall } from '../types';

export function extractToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const regex = new RegExp(TOOL_CALL_REGEX.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const name = match[1];
    const jsonStr = match[2].trim();
    try {
      const payload = JSON.parse(jsonStr);
      calls.push({ name, payload, raw: match[0] });
    } catch {
      try {
        const fixed = jsonStr
          .replace(/,\s*}/g, '}')
          .replace(/,\s*]/g, ']')
          .replace(/'/g, '"');
        const payload = JSON.parse(fixed);
        calls.push({ name, payload, raw: match[0] });
      } catch {
        // unparseable, skip
      }
    }
  }

  return calls;
}

export function stripToolCalls(text: string): string {
  return text.replace(new RegExp(TOOL_CALL_REGEX.source, 'g'), '').trim();
}
