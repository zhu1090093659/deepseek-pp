import type {
  BrowserControlSettings,
  BrowserControlState,
  BrowserControlTarget,
} from './types';

export function decodeBrowserControlSettings(
  value: unknown,
  path = 'browserControlSettings',
): BrowserControlSettings {
  const record = recordValue(value, path);
  return {
    ...record,
    enabled: booleanValue(record.enabled, `${path}.enabled`),
    targetTabId: nullableInteger(record.targetTabId, `${path}.targetTabId`),
    includeSnapshotAfterActions: booleanValue(
      record.includeSnapshotAfterActions,
      `${path}.includeSnapshotAfterActions`,
    ),
    maxSnapshotNodes: integerValue(record.maxSnapshotNodes, `${path}.maxSnapshotNodes`),
    maxSnapshotTextBytes: integerValue(
      record.maxSnapshotTextBytes,
      `${path}.maxSnapshotTextBytes`,
    ),
  } as BrowserControlSettings;
}

export function decodeBrowserControlState(
  value: unknown,
  path = 'browserControlState',
): BrowserControlState {
  const record = recordValue(value, path);
  return {
    ...record,
    supported: booleanValue(record.supported, `${path}.supported`),
    enabled: booleanValue(record.enabled, `${path}.enabled`),
    attached: booleanValue(record.attached, `${path}.attached`),
    targetTabId: nullableInteger(record.targetTabId, `${path}.targetTabId`),
    target: record.target === null
      ? null
      : decodeBrowserControlTarget(record.target, `${path}.target`),
    targets: arrayValue(record.targets, `${path}.targets`).map((target, index) => (
      decodeBrowserControlTarget(target, `${path}.targets[${index}]`)
    )),
    error: nullableString(record.error, `${path}.error`),
  } as BrowserControlState;
}

export function decodeBrowserControlTarget(
  value: unknown,
  path = 'browserControlTarget',
): BrowserControlTarget {
  const record = recordValue(value, path);
  return {
    ...record,
    id: integerValue(record.id, `${path}.id`),
    windowId: integerValue(record.windowId, `${path}.windowId`),
    groupId: integerValue(record.groupId, `${path}.groupId`),
    ...(record.groupName === undefined
      ? {}
      : { groupName: stringValue(record.groupName, `${path}.groupName`) }),
    active: booleanValue(record.active, `${path}.active`),
    currentWindow: booleanValue(record.currentWindow, `${path}.currentWindow`),
    title: stringValue(record.title, `${path}.title`),
    url: stringValue(record.url, `${path}.url`),
    controllable: booleanValue(record.controllable, `${path}.controllable`),
    ...(record.reason === undefined
      ? {}
      : { reason: stringValue(record.reason, `${path}.reason`) }),
  } as BrowserControlTarget;
}

function recordValue(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean`);
  return value;
}

function integerValue(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`${path} must be a safe integer`);
  }
  return value;
}

function nullableInteger(value: unknown, path: string): number | null {
  return value === null ? null : integerValue(value, path);
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new Error(`${path} must be a string`);
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  return value === null ? null : stringValue(value, path);
}
