import { decodeScenarioState } from '../../../core/scenario/codec';
import type { ScenarioRuntimeRequest } from '../../../core/scenario/runtime-request-codec';
import type { ScenarioConfig } from '../../../core/types';
import {
  sidepanelRuntimeClient,
  type SidepanelRuntimeClient,
} from '../runtime-client';

export interface ScenarioController {
  getAll(): Promise<ScenarioConfig[]>;
  mutate(request: Exclude<ScenarioRuntimeRequest, { operation: 'refresh' | 'get' }>): Promise<ScenarioConfig[]>;
}

export function createScenarioController(
  runtimeClient: SidepanelRuntimeClient = sidepanelRuntimeClient,
): ScenarioController {
  const request = (payload: ScenarioRuntimeRequest) => runtimeClient.request(
    { type: 'SCENARIOS_UPDATED', payload },
    { decode: decodeScenarioResponse },
  );

  return Object.freeze({
    getAll: () => request({ operation: 'get' }),
    mutate: request,
  });
}

function decodeScenarioResponse(value: unknown): ScenarioConfig[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid SCENARIOS_UPDATED runtime response.');
  }
  const response = value as Record<string, unknown>;
  if (response.ok !== true || !('scenarios' in response)) {
    throw new Error('Invalid SCENARIOS_UPDATED runtime response.');
  }
  return decodeScenarioState(response.scenarios, 'SCENARIOS_UPDATED.response.scenarios');
}
