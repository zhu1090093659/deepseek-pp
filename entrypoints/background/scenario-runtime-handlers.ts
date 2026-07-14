import type { ScenarioConfig } from '../../core/types';
import type { RuntimeCommandHandler } from '../../core/messaging/runtime-command-registry';
import { defineBackgroundPayloadRuntimeCommandHandler } from './runtime-handler';

export interface ScenarioRuntimeHandlerDependencies {
  getAllScenarios(): Promise<ScenarioConfig[]>;
  saveScenario(scenario: ScenarioConfig): Promise<void>;
  addCustomScenario(label: string, template: string): Promise<ScenarioConfig>;
  deleteScenario(id: string): Promise<void>;
  refreshScenarioMenus(): Promise<void>;
}

export function createScenarioRuntimeHandlers(
  dependencies: ScenarioRuntimeHandlerDependencies,
): readonly RuntimeCommandHandler[] {
  return Object.freeze([
    defineBackgroundPayloadRuntimeCommandHandler('SCENARIOS_UPDATED', async (request) => {
      if (request.operation === 'refresh') {
        await dependencies.refreshScenarioMenus();
        return { ok: true as const };
      }
      if (request.operation === 'get') {
        return { ok: true as const, scenarios: await dependencies.getAllScenarios() };
      }
      if (request.operation === 'save') {
        await dependencies.saveScenario(request.scenario);
      } else if (request.operation === 'add') {
        await dependencies.addCustomScenario(request.label, request.template);
      } else {
        await dependencies.deleteScenario(request.id);
      }
      await dependencies.refreshScenarioMenus();
      return { ok: true as const, scenarios: await dependencies.getAllScenarios() };
    }),
  ]);
}
