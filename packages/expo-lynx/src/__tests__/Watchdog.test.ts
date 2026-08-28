import { computeNotifyAppReady, isWatchdogTimeout, type PendingActivation } from '../Watchdog';

const PENDING: PendingActivation = {
  manifestId: 'v2-sha',
  feature: 'delivery',
  appliedAt: '2026-08-27T10:00:00Z',
};

describe('computeNotifyAppReady', () => {
  it('returns STABLE when no pending activation', () => {
    expect(computeNotifyAppReady(null, true)).toEqual({ status: 'STABLE' });
    expect(computeNotifyAppReady(null, false)).toEqual({ status: 'STABLE' });
  });

  it('returns STABLE when pending and notifyAppReady is reached', () => {
    expect(computeNotifyAppReady(PENDING, true)).toEqual({ status: 'STABLE' });
  });

  it('returns RECOVERED with crashedBundleId when pending and NOT reached (crash)', () => {
    expect(computeNotifyAppReady(PENDING, false)).toEqual({
      status: 'RECOVERED',
      crashedBundleId: 'v2-sha',
    });
  });
});

describe('isWatchdogTimeout', () => {
  it('returns false when within timeout', () => {
    expect(isWatchdogTimeout(1000, 1500, 5000)).toBe(false);
  });

  it('returns true when exactly at timeout', () => {
    expect(isWatchdogTimeout(1000, 6000, 5000)).toBe(true);
  });

  it('returns true when past timeout', () => {
    expect(isWatchdogTimeout(1000, 9999, 5000)).toBe(true);
  });
});
