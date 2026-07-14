import { isToolCallRestoreRecord } from '../messaging/tool-record-codec';
import type { ToolCallRestoreRecord } from '../types';

export interface PersistedToolExecutionBlock extends ToolCallRestoreRecord {
  source: 'storage';
  url: string;
  createdAt: number;
}

export function decodeToolExecutionBlocks(
  value: unknown,
  path = 'toolExecutionBlocks',
): PersistedToolExecutionBlock[] {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be a versionless array`);
  }

  return value.map((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isToolCallRestoreRecord(item)) {
      throw new Error(`${itemPath} is not a valid tool restore record`);
    }
    if (item.source !== 'storage') {
      throw new Error(`${itemPath}.source must be storage`);
    }
    if (typeof item.url !== 'string') {
      throw new Error(`${itemPath}.url must be a string`);
    }
    if (typeof item.createdAt !== 'number' || !Number.isFinite(item.createdAt)) {
      throw new Error(`${itemPath}.createdAt must be a finite number`);
    }
    return item as unknown as PersistedToolExecutionBlock;
  });
}

export const toolExecutionBlockCodec = Object.freeze({
  decode: decodeToolExecutionBlocks,
  encode(value: PersistedToolExecutionBlock[]): unknown {
    return decodeToolExecutionBlocks(value);
  },
});
