import type { SSEEvent } from '../types';

export function parseSSEChunk(chunk: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  const blocks = chunk.split('\n\n');

  for (const block of blocks) {
    if (!block.trim()) continue;

    const event: Partial<SSEEvent> = {};
    const lines = block.split('\n');

    for (const line of lines) {
      if (line.startsWith('id:')) {
        event.id = line.slice(3).trim();
      } else if (line.startsWith('event:')) {
        event.type = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        event.data = (event.data ?? '') + line.slice(5).trim();
      }
    }

    if (event.data !== undefined) {
      events.push({
        type: event.type ?? 'message',
        data: event.data,
        id: event.id,
      });
    }
  }

  return events;
}

export function extractTextFromSSEData(data: string): string | null {
  try {
    const parsed = JSON.parse(data);

    if (typeof parsed.v === 'string') {
      return parsed.v;
    }

    if (parsed.p && parsed.o === 'APPEND' && typeof parsed.v === 'string') {
      return parsed.v;
    }

    return null;
  } catch {
    return null;
  }
}

export function isStreamFinished(data: string): boolean {
  try {
    const parsed = JSON.parse(data);
    if (parsed.p === 'response/status' && parsed.v === 'FINISHED') return true;
    if (parsed.o === 'BATCH' && Array.isArray(parsed.v)) {
      return parsed.v.some(
        (item: { p: string; v: string }) => item.p === 'quasi_status' && item.v === 'FINISHED',
      );
    }
    return false;
  } catch {
    return false;
  }
}
