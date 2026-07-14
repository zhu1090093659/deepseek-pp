import { isToolCallHistoryRecord } from '../messaging/tool-record-codec';
import type { ToolCallHistoryRecord } from './types';

export class ToolHistoryStorageContractError extends Error {
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'ToolHistoryStorageContractError';
  }
}

/** Strict decoder for the released bare-array Tool History contract. */
export function decodeToolCallHistory(
  raw: unknown,
  path = 'toolHistory',
): ToolCallHistoryRecord[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) fail(path, 'Expected the released tool history array.');

  const ids = new Set<string>();
  return raw.map((value, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isToolCallHistoryRecord(value)) fail(itemPath, 'Invalid tool history record.');
    const record = value as unknown as ToolCallHistoryRecord;
    if (ids.has(record.id)) fail(itemPath, `Duplicate tool history id: ${record.id}.`);
    ids.add(record.id);
    return record;
  });
}

export function encodeToolCallHistory(
  records: readonly ToolCallHistoryRecord[],
): ToolCallHistoryRecord[] {
  return decodeToolCallHistory([...records]);
}

function fail(path: string, message: string): never {
  throw new ToolHistoryStorageContractError(path, message);
}
