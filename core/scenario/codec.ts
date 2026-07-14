import type { ScenarioConfig } from '../types';
import type { VersionedValueCodec } from '../persistence/versioned-repository';

export const scenarioCodec: VersionedValueCodec<ScenarioConfig[]> = {
  decode: decodeScenarioState,
  encode(value) {
    return decodeScenarioState(value, 'scenarios');
  },
};

export function decodeScenarioState(value: unknown, path = 'scenarios'): ScenarioConfig[] {
  if (!Array.isArray(value)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'schemaVersion' in value) {
      throw new Error(`${path}.schemaVersion is not supported`);
    }
    throw new Error(`${path} must use the released array schema`);
  }

  const scenarios = value.map((item, index) => decodeScenario(item, `${path}[${index}]`));
  const seen = new Set<string>();
  for (const scenario of scenarios) {
    if (seen.has(scenario.id)) throw new Error(`${path} contains duplicate scenario: ${scenario.id}`);
    seen.add(scenario.id);
  }
  return scenarios;
}

export function decodeScenario(value: unknown, path = 'scenario'): ScenarioConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  const object = value as Record<string, unknown>;
  return {
    ...object,
    id: stringValue(object.id, `${path}.id`),
    label: stringValue(object.label, `${path}.label`),
    template: stringValue(object.template, `${path}.template`),
    builtIn: booleanValue(object.builtIn, `${path}.builtIn`),
    enabled: booleanValue(object.enabled, `${path}.enabled`),
  } as ScenarioConfig;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new Error(`${path} must be a string`);
  return value;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean`);
  return value;
}
