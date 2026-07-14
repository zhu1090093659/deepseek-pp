import {
  decodeAutomationCreateInput,
  decodeAutomationIdRequest,
  decodeAutomationRunsRequest,
  decodeAutomationStatusRequest,
  decodeAutomationUpdateRequest,
  type AutomationIdRequest,
  type AutomationRunsRequest,
  type AutomationStatusRequest,
  type AutomationUpdateRequest,
} from '../automation/runtime-request-codec';
import type { AutomationCreateInput } from '../automation/types';
import {
  decodeScenarioRuntimeRequest,
  type ScenarioRuntimeRequest,
} from '../scenario/runtime-request-codec';
import { decodeSyncCommandTarget } from '../sync/config';
import type { SyncCommandTarget } from '../types';
import { normalizeUsageRangeDays } from '../usage/stats';
import { normalizeUsageTurnInput } from '../usage/input-codec';
import type { UsageRangeDays, UsageTurnRecord } from '../usage/types';
import type { BackgroundRuntimeCommandContracts } from './background-runtime-contracts';

type BackgroundRuntimeCommandType = keyof BackgroundRuntimeCommandContracts;

interface DecodedBackgroundRuntimePayloads {
  RECORD_USAGE_TURN: UsageTurnRecord;
  GET_USAGE_SUMMARY: { rangeDays: UsageRangeDays };
  SAVE_SYNC_CONFIG: SyncCommandTarget;
  WEBDAV_TEST: SyncCommandTarget;
  SYNC_AUTHORIZE: SyncCommandTarget;
  WEBDAV_UPLOAD_LOCAL: SyncCommandTarget;
  WEBDAV_DOWNLOAD_REMOTE: SyncCommandTarget;
  GET_AUTOMATION_RUNS: AutomationRunsRequest;
  CREATE_AUTOMATION: AutomationCreateInput;
  UPDATE_AUTOMATION: AutomationUpdateRequest;
  SET_AUTOMATION_STATUS: AutomationStatusRequest;
  DELETE_AUTOMATION: AutomationIdRequest;
  RUN_AUTOMATION_NOW: AutomationIdRequest;
  SCENARIOS_UPDATED: ScenarioRuntimeRequest;
}

export type BackgroundRuntimePayloadCommandType = keyof DecodedBackgroundRuntimePayloads;

export type BackgroundRuntimeDecodedPayload<
  TType extends BackgroundRuntimePayloadCommandType,
> = DecodedBackgroundRuntimePayloads[TType];

type BackgroundRuntimePayloadDecoderMap = {
  [TType in BackgroundRuntimePayloadCommandType]: (
    value: unknown,
  ) => BackgroundRuntimeDecodedPayload<TType>;
};

export const BACKGROUND_RUNTIME_PAYLOAD_DECODERS: BackgroundRuntimePayloadDecoderMap = {
  RECORD_USAGE_TURN: normalizeUsageTurnInput,
  GET_USAGE_SUMMARY(value) {
    const payload = isRecord(value) ? value : {};
    return { rangeDays: normalizeUsageRangeDays(payload.rangeDays) };
  },
  SAVE_SYNC_CONFIG: decodeSyncCommandTarget,
  WEBDAV_TEST: decodeSyncCommandTarget,
  SYNC_AUTHORIZE: decodeSyncCommandTarget,
  WEBDAV_UPLOAD_LOCAL: decodeSyncCommandTarget,
  WEBDAV_DOWNLOAD_REMOTE: decodeSyncCommandTarget,
  GET_AUTOMATION_RUNS: decodeAutomationRunsRequest,
  CREATE_AUTOMATION: decodeAutomationCreateInput,
  UPDATE_AUTOMATION: decodeAutomationUpdateRequest,
  SET_AUTOMATION_STATUS: decodeAutomationStatusRequest,
  DELETE_AUTOMATION(value) {
    return decodeAutomationIdRequest(value, 'DELETE_AUTOMATION');
  },
  RUN_AUTOMATION_NOW(value) {
    return decodeAutomationIdRequest(value, 'RUN_AUTOMATION_NOW');
  },
  SCENARIOS_UPDATED: decodeScenarioRuntimeRequest,
};

export function decodeBackgroundRuntimePayload<
  TType extends BackgroundRuntimePayloadCommandType,
>(
  type: TType,
  value: unknown,
): BackgroundRuntimeDecodedPayload<TType> {
  return BACKGROUND_RUNTIME_PAYLOAD_DECODERS[type](value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

type _AllBackgroundPayloadCommandsAreRegistered = Exclude<
  BackgroundRuntimePayloadCommandType,
  BackgroundRuntimeCommandType
> extends never ? true : never;

const _allBackgroundPayloadCommandsAreRegistered: _AllBackgroundPayloadCommandsAreRegistered = true;
void _allBackgroundPayloadCommandsAreRegistered;
