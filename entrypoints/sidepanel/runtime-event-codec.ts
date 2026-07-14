import type { DeepSeekTheme } from '../../core/types';

export function isSidepanelRuntimeEvent<TType extends string>(
  value: unknown,
  types: readonly TType[],
): value is { type: TType } {
  const record = plainRecord(value);
  return record !== null
    && typeof record.type === 'string'
    && types.includes(record.type as TType);
}

export function decodeThemeUpdatedEvent(value: unknown): DeepSeekTheme | null {
  const record = plainRecord(value);
  if (record?.type !== 'THEME_UPDATED') return null;
  return record.theme === 'light' || record.theme === 'dark'
    ? record.theme
    : null;
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  return value as Record<string, unknown>;
}
