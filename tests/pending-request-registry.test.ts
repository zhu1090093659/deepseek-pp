import { describe, expect, it } from 'vitest';
import { PendingRequestRegistry } from '../core/tool/pending-request-registry';

describe('pending request registry', () => {
  it('drains only the interrupted request and never returns it again', () => {
    const registry = new PendingRequestRegistry<string>();
    registry.set('request-1', 'call-1', 'first');
    registry.set('request-1', 'call-2', 'second');
    registry.set('request-2', 'call-3', 'other');

    expect(registry.drain('request-1')).toEqual(['first', 'second']);
    expect(registry.drain('request-1')).toEqual([]);
    expect(registry.drain('request-2')).toEqual(['other']);
  });

  it('removes a completed call before terminal cleanup', () => {
    const registry = new PendingRequestRegistry<string>();
    registry.set('request-1', 'call-1', 'started');
    registry.delete('request-1', 'call-1');

    expect(registry.drain('request-1')).toEqual([]);
  });

  it('drains every remaining request during lifecycle teardown', () => {
    const registry = new PendingRequestRegistry<string>();
    registry.set('request-1', 'call-1', 'first');
    registry.set('request-2', 'call-2', 'second');

    expect(registry.drainAll()).toEqual(['first', 'second']);
    expect(registry.drainAll()).toEqual([]);
    expect(registry.drain('request-1')).toEqual([]);
  });
});
