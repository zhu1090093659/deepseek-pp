import { describe, expect, it, vi } from 'vitest';
import { createLatestSyncGate } from '../core/tool/latest-sync';

describe('latest tool descriptor synchronization', () => {
  it('prevents an older success from replacing newer fail-closed state', () => {
    const gate = createLatestSyncGate();
    const older = gate.begin();
    const newer = gate.begin();
    const applyOlder = vi.fn();
    const disableNewer = vi.fn();

    expect(newer.commit(disableNewer)).toBe(true);
    expect(older.commit(applyOlder)).toBe(false);
    expect(disableNewer).toHaveBeenCalledOnce();
    expect(applyOlder).not.toHaveBeenCalled();
  });

  it('prevents an older failure from clearing a newer successful catalog', () => {
    const gate = createLatestSyncGate();
    const older = gate.begin();
    const newer = gate.begin();
    const disableOlder = vi.fn();
    const applyNewer = vi.fn();

    expect(newer.commit(applyNewer)).toBe(true);
    expect(older.commit(disableOlder)).toBe(false);
    expect(applyNewer).toHaveBeenCalledOnce();
    expect(disableOlder).not.toHaveBeenCalled();
  });
});
