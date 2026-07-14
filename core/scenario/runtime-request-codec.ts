import type { ScenarioConfig } from '../types';
import { decodeScenario } from './codec';

export type ScenarioRuntimeRequest =
  | { operation: 'refresh' }
  | { operation: 'get' }
  | { operation: 'save'; scenario: ScenarioConfig }
  | { operation: 'add'; label: string; template: string }
  | { operation: 'delete'; id: string };

export function decodeScenarioRuntimeRequest(value: unknown): ScenarioRuntimeRequest {
  if (value === undefined) return { operation: 'refresh' };
  const payload = recordValue(value, 'SCENARIOS_UPDATED.payload');
  const operation = payload.operation;

  if (operation === 'refresh' || operation === 'get') {
    assertOnlyKeys(payload, ['operation']);
    return { operation };
  }
  if (operation === 'save') {
    assertOnlyKeys(payload, ['operation', 'scenario']);
    recordValue(payload.scenario, 'SCENARIOS_UPDATED.payload.scenario');
    return {
      operation,
      scenario: decodeScenario(payload.scenario, 'SCENARIOS_UPDATED.payload.scenario'),
    };
  }
  if (operation === 'add') {
    assertOnlyKeys(payload, ['operation', 'label', 'template']);
    return {
      operation,
      label: nonEmptyString(payload.label, 'SCENARIOS_UPDATED.payload.label'),
      template: nonEmptyString(payload.template, 'SCENARIOS_UPDATED.payload.template'),
    };
  }
  if (operation === 'delete') {
    assertOnlyKeys(payload, ['operation', 'id']);
    return {
      operation,
      id: nonEmptyString(payload.id, 'SCENARIOS_UPDATED.payload.id'),
    };
  }
  throw new Error('SCENARIOS_UPDATED.payload.operation is not supported.');
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain object.`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function assertOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const allowed = new Set(keys);
  const unsupported = Object.keys(value).find((key) => !allowed.has(key));
  if (unsupported) {
    throw new Error(`SCENARIOS_UPDATED.payload contains an unsupported field: ${unsupported}`);
  }
}
