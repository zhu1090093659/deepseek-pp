import type {
  Automation,
  AutomationCreateInput,
  AutomationRun,
  AutomationRunListOptions,
  AutomationStatus,
  AutomationUpdateInput,
} from '../../core/automation/types';
import {
  definePayloadlessRuntimeCommandHandler,
  type RuntimeCommandHandler,
} from '../../core/messaging/runtime-command-registry';
import { defineBackgroundPayloadRuntimeCommandHandler } from './runtime-handler';

type AutomationDomainFailure = { ok: false; error: string };

export interface AutomationRuntimeHandlerDependencies {
  getAllAutomations(): Promise<Automation[]>;
  getAutomationRuns(options: AutomationRunListOptions): Promise<AutomationRun[]>;
  createAutomation(input: AutomationCreateInput): Promise<Automation>;
  updateAutomation(id: string, patch: AutomationUpdateInput): Promise<Automation | null>;
  setAutomationStatus(id: string, status: AutomationStatus): Promise<Automation | null>;
  deleteAutomation(id: string): Promise<void>;
  refreshAutomationNextRunAt(id: string): Promise<Automation | null>;
  cancelActiveAutomationRun(id: string): void;
  runAutomationNow(id: string, excludeTabId?: number): Promise<AutomationRun | AutomationDomainFailure>;
  broadcastAutomationUpdate(excludeTabId?: number): Promise<void>;
  broadcastAutomationRunsUpdate(excludeTabId?: number): Promise<void>;
}

export function createAutomationRuntimeHandlers(
  dependencies: AutomationRuntimeHandlerDependencies,
): readonly RuntimeCommandHandler[] {
  return Object.freeze([
    definePayloadlessRuntimeCommandHandler('GET_AUTOMATIONS', () => (
      dependencies.getAllAutomations()
    )),
    defineBackgroundPayloadRuntimeCommandHandler('GET_AUTOMATION_RUNS', (payload) => (
      dependencies.getAutomationRuns(payload)
    )),
    defineBackgroundPayloadRuntimeCommandHandler('CREATE_AUTOMATION', async (input, context) => {
      const automation = await dependencies.createAutomation(input);
      const refreshed = await dependencies.refreshAutomationNextRunAt(automation.id);
      await dependencies.broadcastAutomationUpdate(context.tabId);
      return refreshed ?? automation;
    }),
    defineBackgroundPayloadRuntimeCommandHandler('UPDATE_AUTOMATION', async ({ id, patch }, context) => {
      const automation = await dependencies.updateAutomation(id, patch);
      if (!automation) return { ok: false as const, error: 'automation_not_found' };
      const refreshed = await dependencies.refreshAutomationNextRunAt(id);
      await dependencies.broadcastAutomationUpdate(context.tabId);
      return refreshed ?? automation;
    }),
    defineBackgroundPayloadRuntimeCommandHandler('SET_AUTOMATION_STATUS', async (request, context) => {
      if (!request.ok) return request;
      const automation = await dependencies.setAutomationStatus(request.id, request.status);
      if (!automation) return { ok: false as const, error: 'automation_not_found' };
      const refreshed = await dependencies.refreshAutomationNextRunAt(request.id);
      await dependencies.broadcastAutomationUpdate(context.tabId);
      return refreshed ?? automation;
    }),
    defineBackgroundPayloadRuntimeCommandHandler('DELETE_AUTOMATION', async ({ id }, context) => {
      dependencies.cancelActiveAutomationRun(id);
      await dependencies.deleteAutomation(id);
      await dependencies.broadcastAutomationUpdate(context.tabId);
      await dependencies.broadcastAutomationRunsUpdate(context.tabId);
      return { ok: true as const };
    }),
    defineBackgroundPayloadRuntimeCommandHandler('RUN_AUTOMATION_NOW', ({ id }, context) => (
      dependencies.runAutomationNow(id, context.tabId)
    )),
  ]);
}
