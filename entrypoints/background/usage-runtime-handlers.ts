import {
  definePayloadlessRuntimeCommandHandler,
  type RuntimeCommandHandler,
} from '../../core/messaging/runtime-command-registry';
import type {
  UsageRangeDays,
  UsageSummary,
  UsageTurnInput,
  UsageTurnRecord,
} from '../../core/usage/types';
import { defineBackgroundPayloadRuntimeCommandHandler } from './runtime-handler';

export interface UsageRuntimeHandlerDependencies {
  recordUsageTurn(input: UsageTurnInput): Promise<UsageTurnRecord>;
  getUsageSummary(rangeDays: UsageRangeDays): Promise<UsageSummary>;
  clearUsageRecords(): Promise<void>;
}

export function createUsageRuntimeHandlers(
  dependencies: UsageRuntimeHandlerDependencies,
): readonly RuntimeCommandHandler[] {
  return Object.freeze([
    defineBackgroundPayloadRuntimeCommandHandler('RECORD_USAGE_TURN', (payload) => (
      dependencies.recordUsageTurn(payload)
    )),
    defineBackgroundPayloadRuntimeCommandHandler('GET_USAGE_SUMMARY', ({ rangeDays }) => (
      dependencies.getUsageSummary(rangeDays)
    )),
    definePayloadlessRuntimeCommandHandler('CLEAR_USAGE_STATS', async () => {
      await dependencies.clearUsageRecords();
      return { ok: true as const };
    }),
  ]);
}
