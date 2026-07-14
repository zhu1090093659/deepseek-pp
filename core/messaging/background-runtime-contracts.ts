import type {
  Automation,
  AutomationCreateInput,
  AutomationRun,
  AutomationStatus,
  AutomationUpdateInput,
} from '../automation/types';
import type {
  MessageAction,
  SyncConfig,
  SyncCounts,
} from '../types';
import type {
  UsageSummary,
  UsageTurnRecord,
} from '../usage/types';
import type { ScenarioRuntimeRequest } from '../scenario/runtime-request-codec';
import type { ScenarioConfig } from '../types';

type DeclaredRuntimeRequest<TType extends MessageAction['type']> = Extract<
  MessageAction,
  { type: TType }
>;

type Ack = { ok: true };
type DomainFailure = { ok: false; error: string };

export type VersionedRuntimeSyncConfig = SyncConfig & {
  schemaVersion: 1;
  revision: number;
};

export interface SyncRuntimeErrorResponse extends DomainFailure {
  code:
    | 'sync_config_conflict'
    | 'sync_config_commit_indeterminate'
    | 'sync_operation_effect_completed_config_persist_failed'
    | 'sync_operation_failed_after_config_commit';
  revision?: number;
  lastSyncAt?: number | null;
  reloadConfig?: true;
  effectCompleted?: true;
}

type SyncRevisionSuccess = { ok: true; revision: number };
type SyncOperationSuccess = {
  ok: true;
  lastSyncAt: number;
  counts: SyncCounts;
  revision: number;
};

export interface BackgroundRuntimeCommandContracts {
  RECORD_USAGE_TURN: {
    request: DeclaredRuntimeRequest<'RECORD_USAGE_TURN'>;
    response: UsageTurnRecord;
  };
  GET_USAGE_SUMMARY: {
    request: DeclaredRuntimeRequest<'GET_USAGE_SUMMARY'>;
    response: UsageSummary;
  };
  CLEAR_USAGE_STATS: {
    request: DeclaredRuntimeRequest<'CLEAR_USAGE_STATS'>;
    response: Ack;
  };
  GET_SYNC_CONFIG: {
    request: DeclaredRuntimeRequest<'GET_SYNC_CONFIG'>;
    response: VersionedRuntimeSyncConfig | null;
  };
  SAVE_SYNC_CONFIG: {
    request: DeclaredRuntimeRequest<'SAVE_SYNC_CONFIG'>;
    response: SyncRevisionSuccess | SyncRuntimeErrorResponse;
  };
  WEBDAV_TEST: {
    request: DeclaredRuntimeRequest<'WEBDAV_TEST'>;
    response: SyncRevisionSuccess | SyncRuntimeErrorResponse;
  };
  SYNC_AUTHORIZE: {
    request: DeclaredRuntimeRequest<'SYNC_AUTHORIZE'>;
    response: ({ ok: true; refreshToken: string; revision: number }) | SyncRuntimeErrorResponse;
  };
  WEBDAV_UPLOAD_LOCAL: {
    request: DeclaredRuntimeRequest<'WEBDAV_UPLOAD_LOCAL'>;
    response: SyncOperationSuccess | SyncRuntimeErrorResponse;
  };
  WEBDAV_DOWNLOAD_REMOTE: {
    request: DeclaredRuntimeRequest<'WEBDAV_DOWNLOAD_REMOTE'>;
    response: SyncOperationSuccess | SyncRuntimeErrorResponse;
  };
  GET_AUTOMATIONS: {
    request: { type: 'GET_AUTOMATIONS' };
    response: Automation[];
  };
  GET_AUTOMATION_RUNS: {
    request: {
      type: 'GET_AUTOMATION_RUNS';
      payload: { automationId: string; limit?: number };
    };
    response: AutomationRun[];
  };
  CREATE_AUTOMATION: {
    request: { type: 'CREATE_AUTOMATION'; payload: AutomationCreateInput };
    response: Automation;
  };
  UPDATE_AUTOMATION: {
    request: {
      type: 'UPDATE_AUTOMATION';
      payload: { id: string; patch: AutomationUpdateInput };
    };
    response: Automation | DomainFailure;
  };
  SET_AUTOMATION_STATUS: {
    request: {
      type: 'SET_AUTOMATION_STATUS';
      payload: { id: string; status: AutomationStatus };
    };
    response: Automation | DomainFailure;
  };
  DELETE_AUTOMATION: {
    request: { type: 'DELETE_AUTOMATION'; payload: { id: string } };
    response: Ack;
  };
  RUN_AUTOMATION_NOW: {
    request: { type: 'RUN_AUTOMATION_NOW'; payload: { id: string } };
    response: AutomationRun | DomainFailure;
  };
  SCENARIOS_UPDATED: {
    request: { type: 'SCENARIOS_UPDATED'; payload?: ScenarioRuntimeRequest };
    response: Ack | { ok: true; scenarios: ScenarioConfig[] };
  };
}
