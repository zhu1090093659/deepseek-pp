import { describe, expect, it } from 'vitest';
import { PendingAuthorizationCorrelations } from '../core/tool/pending-authorization-correlations';

describe('pending authorization correlations', () => {
  it('turns an early terminal event into a late-activation tombstone', () => {
    const correlations = new PendingAuthorizationCorrelations();
    expect(correlations.begin('main-request-1')).toBe(true);

    correlations.terminate('main-request-1');

    expect(correlations.activate('main-request-1')).toBe(true);
    expect(correlations.begin('main-request-1')).toBe(true);
  });

  it('marks every in-flight augmentation terminal on bridge disconnect', () => {
    const correlations = new PendingAuthorizationCorrelations();
    correlations.begin('main-request-1');
    correlations.begin('main-request-2');

    correlations.terminateAll();

    expect(correlations.activate('main-request-1')).toBe(true);
    expect(correlations.activate('main-request-2')).toBe(true);
  });

  it('rejects duplicate in-flight correlation identities and cleans failed work', () => {
    const correlations = new PendingAuthorizationCorrelations();
    expect(correlations.begin('main-request-1')).toBe(true);
    expect(correlations.begin('main-request-1')).toBe(false);

    correlations.finish('main-request-1');

    expect(correlations.begin('main-request-1')).toBe(true);
  });
});
