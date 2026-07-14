import type { UsageRangeDays, UsageSummary } from '../../../core/types';
import { isUsageSummary } from '../../../core/usage/summary-codec';
import {
  sidepanelRuntimeClient,
  type SidepanelRuntimeClient,
} from '../runtime-client';

export interface UsageController {
  getSummary(rangeDays: UsageRangeDays): Promise<UsageSummary>;
  clear(): Promise<void>;
}

export function createUsageController(
  runtimeClient: SidepanelRuntimeClient = sidepanelRuntimeClient,
): UsageController {
  return Object.freeze({
    getSummary: (rangeDays: UsageRangeDays) => runtimeClient.request(
      { type: 'GET_USAGE_SUMMARY', payload: { rangeDays } },
      {
        decode(value) {
          if (!isUsageSummary(value) || value.rangeDays !== rangeDays) {
            throw new Error('Invalid GET_USAGE_SUMMARY response.');
          }
          return value;
        },
      },
    ),
    async clear() {
      await runtimeClient.request(
        { type: 'CLEAR_USAGE_STATS' },
        {
          decode(value) {
            if (!value || typeof value !== 'object' || (value as { ok?: unknown }).ok !== true) {
              throw new Error('Invalid CLEAR_USAGE_STATS response.');
            }
          },
        },
      );
    },
  });
}

export const usageController = createUsageController();
