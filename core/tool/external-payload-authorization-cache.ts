import type { ToolAuthorizationSubject } from './types';

interface ExternalPayloadAuthorizationBinding {
  grantId: string;
  callId: string;
  invocationName: string;
  subject: ToolAuthorizationSubject;
}

interface CachedExternalPayloadAuthorizationBinding extends ExternalPayloadAuthorizationBinding {
  expiresAt: number;
}

/**
 * In-memory hot-path proof that the first payload chunk already passed the
 * persisted grant check. A service-worker restart drops this cache and safely
 * falls back to the full authorization path.
 */
export class ExternalPayloadAuthorizationCache {
  private readonly bindings = new Map<string, CachedExternalPayloadAuthorizationBinding>();

  has(input: ExternalPayloadAuthorizationBinding, now: number = Date.now()): boolean {
    const key = createKey(input.grantId, input.callId);
    const binding = this.bindings.get(key);
    if (binding && binding.expiresAt <= now) {
      this.bindings.delete(key);
      return false;
    }
    return Boolean(binding &&
      binding.invocationName === input.invocationName &&
      subjectsMatch(binding.subject, input.subject));
  }

  remember(
    input: ExternalPayloadAuthorizationBinding,
    expiresAt: number,
    now: number = Date.now(),
  ): void {
    this.pruneExpired(now);
    this.bindings.set(createKey(input.grantId, input.callId), {
      ...input,
      subject: { ...input.subject },
      expiresAt,
    });
  }

  deleteCall(grantId: string, callId: string): void {
    this.bindings.delete(createKey(grantId, callId));
  }

  deleteGrant(grantId: string): void {
    const prefix = `${grantId}:`;
    for (const key of this.bindings.keys()) {
      if (key.startsWith(prefix)) this.bindings.delete(key);
    }
  }

  private pruneExpired(now: number): void {
    for (const [key, binding] of this.bindings) {
      if (binding.expiresAt <= now) this.bindings.delete(key);
    }
  }
}

function createKey(grantId: string, callId: string): string {
  return `${grantId}:${callId}`;
}

function subjectsMatch(
  left: ToolAuthorizationSubject,
  right: ToolAuthorizationSubject,
): boolean {
  return left.surface === right.surface &&
    left.documentSessionId === right.documentSessionId &&
    left.tabId === right.tabId &&
    left.frameId === right.frameId &&
    normalizeChatSessionId(left.chatSessionId) === normalizeChatSessionId(right.chatSessionId);
}

function normalizeChatSessionId(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
