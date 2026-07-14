import type { RuntimeCommandHandler } from '../../core/messaging/runtime-command-registry';
import {
  createAutomationRuntimeHandlers,
  type AutomationRuntimeHandlerDependencies,
} from './automation-runtime-handlers';
import {
  createSyncRuntimeHandlers,
  type SyncRuntimeHandlerDependencies,
} from './sync-runtime-handlers';
import {
  createUsageRuntimeHandlers,
  type UsageRuntimeHandlerDependencies,
} from './usage-runtime-handlers';
import {
  createScenarioRuntimeHandlers,
  type ScenarioRuntimeHandlerDependencies,
} from './scenario-runtime-handlers';

export interface BackgroundRuntimeHandlerDependencies {
  usage: UsageRuntimeHandlerDependencies;
  sync: SyncRuntimeHandlerDependencies;
  automation: AutomationRuntimeHandlerDependencies;
  scenario: ScenarioRuntimeHandlerDependencies;
}

export function createBackgroundRuntimeHandlers(
  dependencies: BackgroundRuntimeHandlerDependencies,
): readonly RuntimeCommandHandler[] {
  return Object.freeze([
    ...createUsageRuntimeHandlers(dependencies.usage),
    ...createSyncRuntimeHandlers(dependencies.sync),
    ...createAutomationRuntimeHandlers(dependencies.automation),
    ...createScenarioRuntimeHandlers(dependencies.scenario),
  ]);
}
