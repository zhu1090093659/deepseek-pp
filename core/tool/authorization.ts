import type {
  RuntimeToolAuthorizationContext,
  ToolAuthorizationDescriptorSnapshot,
  ToolAuthorizationGrantSummary,
  ToolAuthorizationSubject,
  ToolCall,
  ToolDescriptor,
  ToolExecutionTrigger,
  ToolResult,
} from './types';
import {
  TOOL_EXECUTION_MODES,
  TOOL_EXECUTION_TRIGGERS,
  TOOL_PROVIDER_KINDS,
  TOOL_RISK_LEVELS,
  TOOL_TRANSPORT_KINDS,
} from './types';
import { isRetryableWebFetchPermissionPrecondition } from './web-fetch-permission';

export const TOOL_AUTHORIZATION_STORAGE_KEY = 'deepseek_pp_tool_authorizations';
const TOOL_AUTHORIZATION_STATE_VERSION = 1 as const;
export const TOOL_AUTHORIZATION_TTL_MS = 30 * 60_000;
const MAX_ACTIVE_GRANTS = 32;
const MAX_CALLS_PER_GRANT = 128;
const MAX_AUTHORIZATION_STATE_BYTES = 4 * 1024 * 1024;

type StoredCallState = 'collecting' | 'executing' | 'consumed' | 'retryable';

interface StoredCallAuthorization {
  descriptorId: string;
  state: StoredCallState;
  fingerprint?: string;
  retryUsed: boolean;
}

interface StoredToolAuthorizationGrant {
  id: string;
  requestId: string;
  trigger: ToolExecutionTrigger;
  chatSessionId: string | null;
  taskId?: string;
  runId?: string;
  automationId?: string;
  automationRunId?: string;
  subject: ToolAuthorizationSubject;
  descriptors: ToolAuthorizationDescriptorSnapshot[];
  calls: Record<string, StoredCallAuthorization>;
  issuedAt: number;
  expiresAt: number;
}

interface ToolAuthorizationState {
  version: typeof TOOL_AUTHORIZATION_STATE_VERSION;
  grants: Record<string, StoredToolAuthorizationGrant>;
}

export interface CreateToolAuthorizationInput {
  requestId: string;
  trigger: ToolExecutionTrigger;
  chatSessionId?: string | null;
  taskId?: string;
  runId?: string;
  automationId?: string;
  automationRunId?: string;
  subject: ToolAuthorizationSubject;
  descriptors: readonly ToolDescriptor[];
  now?: number;
}

export interface AuthorizedToolExecution {
  call: ToolCall;
  descriptor: ToolDescriptor;
  trigger: ToolExecutionTrigger;
  reservation: {
    grantId: string;
    callId: string;
  } | null;
  externalPayloadNamespace?: string;
}

export class ToolAuthorizationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ToolAuthorizationError';
  }
}

let authorizationMutation = Promise.resolve();

export async function createToolAuthorization(
  input: CreateToolAuthorizationInput,
): Promise<ToolAuthorizationGrantSummary> {
  const requestId = requireIdentity(input.requestId, 'requestId');
  const now = input.now ?? Date.now();
  const chatSessionId = normalizeChatSessionId(input.chatSessionId);
  assertSubjectSession(input.subject, chatSessionId);

  const descriptors = input.descriptors.filter(isExecutableDescriptor);
  assertUniqueDescriptorIds(descriptors);
  const id = crypto.randomUUID();
  const grant: StoredToolAuthorizationGrant = {
    id,
    requestId,
    trigger: input.trigger,
    chatSessionId,
    taskId: input.taskId,
    runId: input.runId,
    automationId: input.automationId,
    automationRunId: input.automationRunId,
    subject: cloneSubject(input.subject),
    descriptors: await Promise.all(descriptors.map(createDescriptorSnapshot)),
    calls: {},
    issuedAt: now,
    expiresAt: now + TOOL_AUTHORIZATION_TTL_MS,
  };

  await mutateState((state) => {
    pruneState(state, now);
    if (Object.keys(state.grants).length >= MAX_ACTIVE_GRANTS) {
      throw new ToolAuthorizationError(
        'tool_authorization_grant_limit',
        'Too many tool authorizations are active.',
      );
    }
    state.grants[id] = grant;
    return { result: undefined, changed: true };
  });

  return {
    id,
    requestId,
    trigger: input.trigger,
    chatSessionId,
    descriptors: [...descriptors],
    expiresAt: grant.expiresAt,
  };
}

export async function authorizeToolExecution(
  call: ToolCall,
  context: RuntimeToolAuthorizationContext,
  currentDescriptors: readonly ToolDescriptor[],
  now: number = Date.now(),
): Promise<AuthorizedToolExecution> {
  if (context.kind === 'trusted') {
    const descriptor = resolveTrustedDescriptor(call, currentDescriptors);
    return {
      call: canonicalizeCall(call, descriptor, {
        trigger: context.trigger,
        requestId: context.requestId,
        chatSessionId: normalizeChatSessionId(context.chatSessionId),
        taskId: context.taskId,
        runId: context.runId,
        automationId: context.automationId,
        automationRunId: context.automationRunId,
      }),
      descriptor,
      trigger: context.trigger,
      reservation: null,
    };
  }

  return mutateState(async (state) => {
    const grant = requireGrant(state, context.grantId, now);
    pruneState(state, now);
    assertSubjectMatches(grant, context.subject);
    assertCallSourceMatchesGrant(call, grant);
    const { snapshot, descriptor } = await resolveGrantedDescriptor(call, grant, currentDescriptors);
    const callId = requireIdentity(call.id, 'call.id');
    const fingerprint = await createToolCallFingerprint(call, snapshot.id);
    const existing = grant.calls[callId];
    if (existing && existing.state !== 'retryable' && existing.state !== 'collecting') {
      throw new ToolAuthorizationError(
        'tool_call_replayed',
        `Tool call ${callId} has already been reserved or consumed.`,
      );
    }
    if (existing && existing.descriptorId !== snapshot.id) {
      throw new ToolAuthorizationError(
        'tool_call_identity_mismatch',
        `Tool call ${callId} is already bound to another descriptor.`,
      );
    }
    if (existing?.fingerprint && existing.fingerprint !== fingerprint) {
      throw new ToolAuthorizationError(
        'tool_call_identity_mismatch',
        `Tool call ${callId} retry payload does not match its original authorization.`,
      );
    }
    if (!existing && Object.keys(grant.calls).length >= MAX_CALLS_PER_GRANT) {
      throw new ToolAuthorizationError(
        'tool_authorization_call_limit',
        'Tool authorization call limit exceeded.',
      );
    }

    grant.calls[callId] = {
      descriptorId: snapshot.id,
      state: 'executing',
      fingerprint,
      retryUsed: existing?.state === 'retryable' ? true : existing?.retryUsed ?? false,
    };
    return {
      result: {
        call: canonicalizeCall(call, descriptor, grant),
        descriptor,
        trigger: grant.trigger,
        reservation: { grantId: grant.id, callId },
        externalPayloadNamespace: grant.id,
      },
      changed: true,
    };
  });
}

export async function authorizeExternalToolPayloadChunk(input: {
  grantId: string;
  subject: ToolAuthorizationSubject;
  callId: string;
  invocationName: string;
  currentDescriptors: readonly ToolDescriptor[];
  now?: number;
}): Promise<{ namespace: string; expiresAt: number }> {
  const callId = requireIdentity(input.callId, 'callId');
  const invocationName = requireIdentity(input.invocationName, 'invocationName');
  const now = input.now ?? Date.now();

  return mutateState(async (state) => {
    const grant = requireGrant(state, input.grantId, now);
    const pruned = pruneState(state, now);
    const subjectChanged = assertSubjectMatches(grant, input.subject);
    const snapshots = grant.descriptors.filter((item) => item.invocationName === invocationName);
    if (snapshots.length !== 1) {
      throw new ToolAuthorizationError(
        'tool_not_authorized',
        `Tool invocation ${invocationName} is not authorized by this request.`,
      );
    }
    const snapshot = snapshots[0];
    await requireCurrentDescriptor(snapshot, input.currentDescriptors);

    const existing = grant.calls[callId];
    if (existing && existing.state !== 'collecting') {
      throw new ToolAuthorizationError(
        'tool_call_replayed',
        `Tool call ${callId} is no longer accepting payload chunks.`,
      );
    }
    if (existing && existing.descriptorId !== snapshot.id) {
      throw new ToolAuthorizationError(
        'tool_call_identity_mismatch',
        `Tool call ${callId} is already bound to another descriptor.`,
      );
    }
    if (!existing && Object.keys(grant.calls).length >= MAX_CALLS_PER_GRANT) {
      throw new ToolAuthorizationError(
        'tool_authorization_call_limit',
        'Tool authorization call limit exceeded.',
      );
    }

    if (!existing) {
      grant.calls[callId] = {
        descriptorId: snapshot.id,
        state: 'collecting',
        retryUsed: false,
      };
    }
    return {
      result: { namespace: grant.id, expiresAt: grant.expiresAt },
      changed: pruned || subjectChanged || !existing,
    };
  });
}

export async function completeToolExecutionAuthorization(
  reservation: AuthorizedToolExecution['reservation'],
  result?: ToolResult,
): Promise<void> {
  if (!reservation) return;
  await mutateState((state) => {
    const grant = state.grants[reservation.grantId];
    const call = grant?.calls[reservation.callId];
    if (!call) return { result: undefined, changed: false };
    call.state = isRetryableWebFetchPermissionPrecondition(call.descriptorId, result) &&
      !call.retryUsed
      ? 'retryable'
      : 'consumed';
    return { result: undefined, changed: true };
  });
}

export async function closeToolAuthorization(
  grantId: string,
  subject: ToolAuthorizationSubject,
): Promise<void> {
  await mutateState((state) => {
    const grant = state.grants[grantId];
    if (!grant) return { result: undefined, changed: false };
    assertOwnerDocumentMatches(grant, subject);
    delete state.grants[grantId];
    return { result: undefined, changed: true };
  });
}

export async function getToolAuthorizationAuditTrigger(
  call: ToolCall,
  context: RuntimeToolAuthorizationContext,
  now: number = Date.now(),
): Promise<ToolExecutionTrigger | null> {
  if (context.kind === 'trusted') return context.trigger;
  try {
    return await mutateState((state) => {
      const grant = requireGrant(state, context.grantId, now);
      assertSubjectMatchesWithoutBinding(grant, context.subject);
      assertCallSourceMatchesGrant(call, grant);
      return { result: grant.trigger, changed: false };
    });
  } catch (error) {
    if (error instanceof ToolAuthorizationError) return null;
    throw error;
  }
}

export function createToolAuthorizationResult(
  error: ToolAuthorizationError,
  call?: Pick<ToolCall, 'id' | 'name' | 'descriptorId' | 'provider'>,
  summary: string = 'Tool authorization rejected',
): ToolResult {
  return {
    ok: false,
    summary,
    detail: error.message,
    callId: call?.id,
    name: call?.name,
    descriptorId: call?.descriptorId,
    provider: call?.provider,
    error: {
      code: error.code,
      message: error.message,
      retryable: false,
    },
  };
}

function resolveTrustedDescriptor(
  call: ToolCall,
  descriptors: readonly ToolDescriptor[],
): ToolDescriptor {
  const descriptor = resolveDescriptorClaim(call, descriptors);
  if (!descriptor) {
    throw new ToolAuthorizationError('tool_unsupported', `Unsupported tool: ${call.name}`);
  }
  if (!isExecutableDescriptor(descriptor)) {
    throw new ToolAuthorizationError('tool_disabled', `Tool ${descriptor.name} is disabled.`);
  }
  assertCallDescriptorClaims(call, descriptor);
  return descriptor;
}

async function resolveGrantedDescriptor(
  call: ToolCall,
  grant: StoredToolAuthorizationGrant,
  currentDescriptors: readonly ToolDescriptor[],
): Promise<{ snapshot: ToolAuthorizationDescriptorSnapshot; descriptor: ToolDescriptor }> {
  const snapshot = resolveSnapshotClaim(call, grant.descriptors);
  if (!snapshot) {
    throw new ToolAuthorizationError(
      'tool_not_authorized',
      `Tool ${call.name} was not authorized for request ${grant.requestId}.`,
    );
  }
  assertCallSnapshotClaims(call, snapshot);
  return { snapshot, descriptor: await requireCurrentDescriptor(snapshot, currentDescriptors) };
}

function resolveDescriptorClaim(
  call: ToolCall,
  descriptors: readonly ToolDescriptor[],
): ToolDescriptor | null {
  if (call.descriptorId) {
    return descriptors.find((descriptor) => descriptor.id === call.descriptorId) ?? null;
  }
  const candidates = call.invocationName
    ? descriptors.filter((descriptor) => descriptor.invocationName === call.invocationName)
    : descriptors.filter((descriptor) => descriptor.name === call.name);
  const providerCandidates = call.provider
    ? candidates.filter((descriptor) => providerMatches(descriptor.provider, call.provider!))
    : candidates;
  return providerCandidates.length === 1 ? providerCandidates[0] : null;
}

function resolveSnapshotClaim(
  call: ToolCall,
  snapshots: readonly ToolAuthorizationDescriptorSnapshot[],
): ToolAuthorizationDescriptorSnapshot | null {
  if (call.descriptorId) {
    return snapshots.find((snapshot) => snapshot.id === call.descriptorId) ?? null;
  }
  const candidates = call.invocationName
    ? snapshots.filter((snapshot) => snapshot.invocationName === call.invocationName)
    : snapshots.filter((snapshot) => snapshot.name === call.name);
  const providerCandidates = call.provider
    ? candidates.filter((snapshot) => providerMatches(snapshot.provider, call.provider!))
    : candidates;
  return providerCandidates.length === 1 ? providerCandidates[0] : null;
}

async function requireCurrentDescriptor(
  snapshot: ToolAuthorizationDescriptorSnapshot,
  currentDescriptors: readonly ToolDescriptor[],
): Promise<ToolDescriptor> {
  const descriptor = currentDescriptors.find((candidate) => candidate.id === snapshot.id);
  if (
    !descriptor ||
    !isExecutableDescriptor(descriptor) ||
    !await descriptorMatchesSnapshot(descriptor, snapshot)
  ) {
    throw new ToolAuthorizationError(
      'tool_authorization_stale',
      `Tool authorization for ${snapshot.name} is stale.`,
    );
  }
  return descriptor;
}

function assertCallDescriptorClaims(call: ToolCall, descriptor: ToolDescriptor): void {
  if (
    call.name !== descriptor.name ||
    (call.invocationName !== undefined && call.invocationName !== descriptor.invocationName) ||
    (call.provider !== undefined && !providerMatches(call.provider, descriptor.provider))
  ) {
    throw new ToolAuthorizationError(
      'tool_descriptor_mismatch',
      `Tool call claims do not match descriptor ${descriptor.id}.`,
    );
  }
}

function assertCallSnapshotClaims(
  call: ToolCall,
  snapshot: ToolAuthorizationDescriptorSnapshot,
): void {
  if (
    call.name !== snapshot.name ||
    (call.invocationName !== undefined && call.invocationName !== snapshot.invocationName) ||
    (call.provider !== undefined && !providerMatches(call.provider, snapshot.provider))
  ) {
    throw new ToolAuthorizationError(
      'tool_descriptor_mismatch',
      `Tool call claims do not match authorized descriptor ${snapshot.id}.`,
    );
  }
}

function assertCallSourceMatchesGrant(call: ToolCall, grant: StoredToolAuthorizationGrant): void {
  const source = call.source;
  if (!source) {
    throw new ToolAuthorizationError('tool_source_missing', 'Authorized tool call source is missing.');
  }
  if (
    source.trigger !== grant.trigger ||
    source.requestId !== grant.requestId ||
    normalizeChatSessionId(source.chatSessionId) !== grant.chatSessionId ||
    optionalIdentityMismatch(source.taskId, grant.taskId) ||
    optionalIdentityMismatch(source.runId, grant.runId) ||
    optionalIdentityMismatch(source.automationId, grant.automationId) ||
    optionalIdentityMismatch(source.automationRunId, grant.automationRunId)
  ) {
    throw new ToolAuthorizationError(
      'tool_session_mismatch',
      'Tool call source does not match its extension-owned authorization context.',
    );
  }
}

function canonicalizeCall(
  call: ToolCall,
  descriptor: ToolDescriptor,
  source: Pick<StoredToolAuthorizationGrant, 'trigger' | 'requestId' | 'chatSessionId' | 'taskId' | 'runId' | 'automationId' | 'automationRunId'>,
): ToolCall {
  return {
    ...call,
    id: call.id ?? crypto.randomUUID(),
    descriptorId: descriptor.id,
    provider: descriptor.provider,
    name: descriptor.name,
    invocationName: descriptor.invocationName,
    source: {
      ...call.source,
      trigger: source.trigger,
      requestId: source.requestId,
      chatSessionId: source.chatSessionId,
      taskId: source.taskId,
      runId: source.runId,
      automationId: source.automationId,
      automationRunId: source.automationRunId,
    },
  };
}

async function createDescriptorSnapshot(
  descriptor: ToolDescriptor,
): Promise<ToolAuthorizationDescriptorSnapshot> {
  return {
    id: descriptor.id,
    provider: {
      kind: descriptor.provider.kind,
      id: descriptor.provider.id,
      transport: descriptor.provider.transport,
    },
    name: descriptor.name,
    invocationName: descriptor.invocationName,
    execution: { ...descriptor.execution },
    inputSchemaDigest: await createInputSchemaSecurityDigest(descriptor.inputSchema),
  };
}

async function descriptorMatchesSnapshot(
  descriptor: ToolDescriptor,
  snapshot: ToolAuthorizationDescriptorSnapshot,
): Promise<boolean> {
  return descriptor.id === snapshot.id &&
    descriptor.name === snapshot.name &&
    descriptor.invocationName === snapshot.invocationName &&
    providerMatches(descriptor.provider, snapshot.provider) &&
    stableJsonStringify(descriptor.execution) === stableJsonStringify(snapshot.execution) &&
    await createInputSchemaSecurityDigest(descriptor.inputSchema) === snapshot.inputSchemaDigest;
}

export async function haveEquivalentToolDescriptorSecurity(
  left: ToolDescriptor,
  right: ToolDescriptor,
): Promise<boolean> {
  return descriptorMatchesSnapshot(right, await createDescriptorSnapshot(left));
}

function providerMatches(
  left: { kind: string; id: string; transport: string },
  right: { kind: string; id: string; transport: string },
): boolean {
  return left.kind === right.kind && left.id === right.id && left.transport === right.transport;
}

function isExecutableDescriptor(descriptor: ToolDescriptor): boolean {
  return descriptor.execution.enabled && descriptor.execution.mode !== 'disabled';
}

function assertUniqueDescriptorIds(descriptors: readonly ToolDescriptor[]): void {
  if (new Set(descriptors.map((descriptor) => descriptor.id)).size === descriptors.length) return;
  throw new ToolAuthorizationError(
    'tool_descriptor_duplicate',
    'Tool authorization descriptors must have unique identities.',
  );
}

function assertSubjectMatches(
  grant: StoredToolAuthorizationGrant,
  current: ToolAuthorizationSubject,
): boolean {
  assertOwnerDocumentMatches(grant, current);
  const expectedChatSessionId = normalizeChatSessionId(grant.subject.chatSessionId);
  const currentChatSessionId = normalizeChatSessionId(current.chatSessionId);
  if (expectedChatSessionId === null) {
    if (currentChatSessionId === null) return false;
    grant.subject.chatSessionId = currentChatSessionId;
    return true;
  }
  if (currentChatSessionId !== expectedChatSessionId) {
    throw new ToolAuthorizationError(
      'tool_session_mismatch',
      'Tool authorization belongs to another chat session.',
    );
  }
  return false;
}

function assertOwnerDocumentMatches(
  grant: StoredToolAuthorizationGrant,
  current: ToolAuthorizationSubject,
): void {
  const expected = grant.subject;
  if (
    current.surface !== expected.surface ||
    current.documentSessionId !== expected.documentSessionId ||
    current.tabId !== expected.tabId ||
    current.frameId !== expected.frameId
  ) {
    throw new ToolAuthorizationError(
      'tool_session_mismatch',
      'Tool authorization belongs to another extension document.',
    );
  }
}

function assertSubjectMatchesWithoutBinding(
  grant: StoredToolAuthorizationGrant,
  current: ToolAuthorizationSubject,
): void {
  assertOwnerDocumentMatches(grant, current);
  const expectedChatSessionId = normalizeChatSessionId(grant.subject.chatSessionId);
  const currentChatSessionId = normalizeChatSessionId(current.chatSessionId);
  if (expectedChatSessionId !== null && currentChatSessionId !== expectedChatSessionId) {
    throw new ToolAuthorizationError(
      'tool_session_mismatch',
      'Tool authorization belongs to another chat session.',
    );
  }
}

function assertSubjectSession(subject: ToolAuthorizationSubject, chatSessionId: string | null): void {
  const subjectChatSessionId = normalizeChatSessionId(subject.chatSessionId);
  if (subjectChatSessionId !== chatSessionId) {
    throw new ToolAuthorizationError(
      'tool_session_mismatch',
      'Requested chat session does not match the browser-owned runtime session.',
    );
  }
}

function cloneSubject(subject: ToolAuthorizationSubject): ToolAuthorizationSubject {
  return {
    surface: subject.surface,
    documentSessionId: requireIdentity(subject.documentSessionId, 'documentSessionId'),
    tabId: subject.tabId,
    frameId: subject.frameId,
    chatSessionId: normalizeChatSessionId(subject.chatSessionId),
  };
}

function optionalIdentityMismatch(claimed: string | undefined, expected: string | undefined): boolean {
  return claimed !== expected;
}

function normalizeChatSessionId(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireIdentity(value: string | undefined, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ToolAuthorizationError('tool_identity_missing', `${label} must be a non-empty string.`);
  }
  return value.trim();
}

function requireGrant(
  state: ToolAuthorizationState,
  grantId: string,
  now: number,
): StoredToolAuthorizationGrant {
  const grant = state.grants[grantId];
  if (!grant) {
    throw new ToolAuthorizationError('tool_authorization_missing', 'Tool authorization is missing or closed.');
  }
  if (grant.expiresAt <= now) {
    delete state.grants[grantId];
    throw new ToolAuthorizationError('tool_authorization_stale', 'Tool authorization has expired.');
  }
  return grant;
}

function pruneState(state: ToolAuthorizationState, now: number): boolean {
  let changed = false;
  for (const [id, grant] of Object.entries(state.grants)) {
    if (grant.expiresAt <= now) {
      delete state.grants[id];
      changed = true;
    }
  }
  return changed;
}

interface StateMutation<T> {
  result: T;
  changed: boolean;
}

async function mutateState<T>(
  operation: (state: ToolAuthorizationState) => StateMutation<T> | Promise<StateMutation<T>>,
): Promise<T> {
  const run = authorizationMutation.then(async () => {
    const state = await readState();
    const mutation = await operation(state);
    if (mutation.changed) {
      assertStateWithinByteBudget(state);
      await chrome.storage.session.set({ [TOOL_AUTHORIZATION_STORAGE_KEY]: state });
    }
    return mutation.result;
  });
  authorizationMutation = run.then(() => undefined, () => undefined);
  return run;
}

async function readState(): Promise<ToolAuthorizationState> {
  const stored = await chrome.storage.session.get(TOOL_AUTHORIZATION_STORAGE_KEY) as Record<string, unknown>;
  const value = stored[TOOL_AUTHORIZATION_STORAGE_KEY];
  if (value === undefined) {
    return { version: TOOL_AUTHORIZATION_STATE_VERSION, grants: {} };
  }
  if (
    new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_AUTHORIZATION_STATE_BYTES ||
    !isStoredAuthorizationState(value)
  ) {
    throw new Error('Stored tool authorization state is invalid.');
  }
  return structuredClone(value);
}

function isStoredAuthorizationState(value: unknown): value is ToolAuthorizationState {
  if (!isPlainRecord(value)) return false;
  const state = value as Partial<ToolAuthorizationState>;
  return hasOnlyKeys(value, ['version', 'grants']) &&
    state.version === TOOL_AUTHORIZATION_STATE_VERSION &&
    isPlainRecord(state.grants) &&
    Object.keys(state.grants).length <= MAX_ACTIVE_GRANTS &&
    Object.entries(state.grants).every(([id, grant]) => isStoredGrant(id, grant));
}

function isStoredGrant(id: string, value: unknown): value is StoredToolAuthorizationGrant {
  if (!isPlainRecord(value)) return false;
  const grant = value as Partial<StoredToolAuthorizationGrant>;
  return hasOnlyKeys(value, [
    'id',
    'requestId',
    'trigger',
    'chatSessionId',
    'taskId',
    'runId',
    'automationId',
    'automationRunId',
    'subject',
    'descriptors',
    'calls',
    'issuedAt',
    'expiresAt',
  ]) &&
    grant.id === id &&
    isIdentity(grant.id) &&
    isIdentity(grant.requestId) &&
    (TOOL_EXECUTION_TRIGGERS as readonly string[]).includes(String(grant.trigger)) &&
    (grant.chatSessionId === null || isIdentity(grant.chatSessionId)) &&
    optionalIdentity(grant.taskId) &&
    optionalIdentity(grant.runId) &&
    optionalIdentity(grant.automationId) &&
    optionalIdentity(grant.automationRunId) &&
    isStoredSubject(grant.subject) &&
    hasValidStoredGrantSessionBinding(grant.chatSessionId, grant.subject) &&
    Array.isArray(grant.descriptors) &&
    grant.descriptors.every(isStoredDescriptorSnapshot) &&
    hasUniqueStoredDescriptorIds(grant.descriptors) &&
    isPlainRecord(grant.calls) &&
    Object.keys(grant.calls).length <= MAX_CALLS_PER_GRANT &&
    hasValidStoredCalls(grant.calls, grant.descriptors) &&
    isFiniteNumber(grant.issuedAt) &&
    isFiniteNumber(grant.expiresAt) &&
    grant.expiresAt > grant.issuedAt;
}

function isStoredSubject(value: unknown): value is ToolAuthorizationSubject {
  if (!isPlainRecord(value)) return false;
  const subject = value as Partial<ToolAuthorizationSubject>;
  return hasOnlyKeys(value, ['surface', 'documentSessionId', 'tabId', 'frameId', 'chatSessionId']) &&
    (
    subject.surface === 'deepseek_content' ||
    subject.surface === 'extension_context' ||
    subject.surface === 'background_workflow'
  ) &&
    isIdentity(subject.documentSessionId) &&
    (subject.tabId === undefined || isNonNegativeInteger(subject.tabId)) &&
    (subject.frameId === undefined || isNonNegativeInteger(subject.frameId)) &&
    (subject.chatSessionId === null || isIdentity(subject.chatSessionId));
}

function hasValidStoredGrantSessionBinding(
  grantChatSessionId: string | null | undefined,
  subject: ToolAuthorizationSubject,
): boolean {
  return grantChatSessionId === null ||
    normalizeChatSessionId(subject.chatSessionId) === grantChatSessionId;
}

function hasUniqueStoredDescriptorIds(
  descriptors: readonly ToolAuthorizationDescriptorSnapshot[],
): boolean {
  return new Set(descriptors.map((descriptor) => descriptor.id)).size === descriptors.length;
}

function hasValidStoredCalls(
  calls: Record<string, unknown>,
  descriptors: readonly ToolAuthorizationDescriptorSnapshot[],
): boolean {
  const descriptorIds = new Set(descriptors.map((descriptor) => descriptor.id));
  return Object.entries(calls).every(([callId, call]) =>
    isStoredCall(callId, call, descriptorIds));
}

function isStoredDescriptorSnapshot(value: unknown): value is ToolAuthorizationDescriptorSnapshot {
  if (!isPlainRecord(value) || !isPlainRecord(value.provider) || !isPlainRecord(value.execution)) return false;
  const snapshot = value as unknown as ToolAuthorizationDescriptorSnapshot;
  return hasOnlyKeys(value, ['id', 'provider', 'name', 'invocationName', 'execution', 'inputSchemaDigest']) &&
    hasOnlyKeys(value.provider, ['kind', 'id', 'transport']) &&
    hasOnlyKeys(value.execution, ['mode', 'enabled', 'risk', 'timeoutMs', 'maxResultBytes']) &&
    isIdentity(snapshot.id) &&
    isIdentity(snapshot.name) &&
    isIdentity(snapshot.invocationName) &&
    (TOOL_PROVIDER_KINDS as readonly string[]).includes(snapshot.provider.kind) &&
    isIdentity(snapshot.provider.id) &&
    (TOOL_TRANSPORT_KINDS as readonly string[]).includes(snapshot.provider.transport) &&
    (TOOL_EXECUTION_MODES as readonly string[]).includes(snapshot.execution.mode) &&
    typeof snapshot.execution.enabled === 'boolean' &&
    (TOOL_RISK_LEVELS as readonly string[]).includes(snapshot.execution.risk) &&
    (snapshot.execution.timeoutMs === undefined || isPositiveNumber(snapshot.execution.timeoutMs)) &&
    (snapshot.execution.maxResultBytes === undefined || isPositiveNumber(snapshot.execution.maxResultBytes)) &&
    typeof snapshot.inputSchemaDigest === 'string' &&
    /^[a-f0-9]{64}$/.test(snapshot.inputSchemaDigest);
}

function isStoredCall(
  id: string,
  value: unknown,
  descriptorIds: ReadonlySet<string>,
): value is StoredCallAuthorization {
  if (!isPlainRecord(value)) return false;
  const call = value as Partial<StoredCallAuthorization>;
  if (
    !hasOnlyKeys(value, ['descriptorId', 'state', 'fingerprint', 'retryUsed']) ||
    !isIdentity(id) ||
    !isIdentity(call.descriptorId) ||
    !descriptorIds.has(call.descriptorId) ||
    typeof call.retryUsed !== 'boolean'
  ) return false;

  const hasFingerprint = typeof call.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(call.fingerprint);
  return (
    call.state === 'collecting' && call.fingerprint === undefined && !call.retryUsed
  ) || (
    (call.state === 'executing' || call.state === 'consumed') && hasFingerprint
  ) || (
    call.state === 'retryable' && hasFingerprint && !call.retryUsed
  );
}

async function createToolCallFingerprint(
  call: ToolCall,
  descriptorId: string,
): Promise<string> {
  return sha256(stableJsonStringify({
    descriptorId,
    name: call.name,
    invocationName: call.invocationName ?? null,
    payload: call.payload,
  }));
}

async function createInputSchemaSecurityDigest(value: unknown): Promise<string> {
  return sha256(stableJsonStringify(stripSchemaNodeDescriptions(value)));
}

const SCHEMA_MAP_KEYWORDS = new Set([
  '$defs',
  'definitions',
  'dependentSchemas',
  'patternProperties',
  'properties',
]);
const SCHEMA_ARRAY_KEYWORDS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const SCHEMA_CHILD_KEYWORDS = new Set([
  'additionalItems',
  'additionalProperties',
  'contains',
  'contentSchema',
  'else',
  'if',
  'items',
  'not',
  'propertyNames',
  'then',
  'unevaluatedItems',
  'unevaluatedProperties',
]);

function stripSchemaNodeDescriptions(value: unknown): unknown {
  if (!isPlainRecord(value)) return value;
  const normalized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'description') continue;
    if (SCHEMA_MAP_KEYWORDS.has(key) && isPlainRecord(item)) {
      normalized[key] = Object.fromEntries(
        Object.entries(item).map(([name, schema]) => [name, stripSchemaNodeDescriptions(schema)]),
      );
      continue;
    }
    if (key === 'dependencies' && isPlainRecord(item)) {
      normalized[key] = Object.fromEntries(
        Object.entries(item).map(([name, dependency]) => [
          name,
          Array.isArray(dependency)
            ? dependency
            : stripSchemaNodeDescriptions(dependency),
        ]),
      );
      continue;
    }
    if (SCHEMA_ARRAY_KEYWORDS.has(key) && Array.isArray(item)) {
      normalized[key] = item.map(stripSchemaNodeDescriptions);
      continue;
    }
    if (SCHEMA_CHILD_KEYWORDS.has(key)) {
      normalized[key] = Array.isArray(item)
        ? item.map(stripSchemaNodeDescriptions)
        : stripSchemaNodeDescriptions(item);
      continue;
    }
    // const/default/enum/examples are instance data, not schema nodes. Keep
    // their own `description` keys intact and let stable serialization order
    // them without changing semantics.
    normalized[key] = item;
  }
  return normalized;
}

function stableJsonStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!isPlainRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJsonValue(value[key])]),
  );
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function assertStateWithinByteBudget(state: ToolAuthorizationState): void {
  const size = new TextEncoder().encode(JSON.stringify(state)).byteLength;
  if (size > MAX_AUTHORIZATION_STATE_BYTES) {
    throw new ToolAuthorizationError(
      'tool_authorization_storage_limit',
      'Tool authorization storage limit exceeded.',
    );
  }
}

function optionalIdentity(value: unknown): boolean {
  return value === undefined || isIdentity(value);
}

function isIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}
