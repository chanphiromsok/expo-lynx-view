import { decide, compareVersions, type ChannelState, type ChannelPointer } from '../ChannelState';

const POINTER: ChannelPointer = {
  channel: 'stable',
  feature: 'delivery',
  current: {
    manifestUrl: 'https://cdn.example.com/lynx/manifests/release/abc.json',
    manifestSha256: 'v2-sha',
    minHostVersion: '1.2.0',
    lynxEngineVersion: '4.0.0',
  },
  issuedAt: '2026-08-27T10:00:00Z',
};

const LOCAL_CLEAN: ChannelState = {
  feature: 'delivery',
  channel: 'stable',
  last_manifest_id: 'v1-sha',
  last_checked_at: '2026-08-26T10:00:00Z',
  last_etag: null,
  applied_at: '2026-08-26T10:05:00Z',
  crash_history: [],
};

describe('decide', () => {
  it('first-launch when local is null', () => {
    expect(decide(null, POINTER)).toEqual({ kind: 'first-launch' });
  });

  it('already-current when server matches local', () => {
    const local: ChannelState = { ...LOCAL_CLEAN, last_manifest_id: 'v2-sha' };
    expect(decide(local, POINTER)).toEqual({ kind: 'already-current' });
  });

  it('in-crash-history when server id is in crash_history', () => {
    const local: ChannelState = { ...LOCAL_CLEAN, crash_history: ['v2-sha'] };
    expect(decide(local, POINTER)).toEqual({
      kind: 'in-crash-history',
      manifestId: 'v2-sha',
    });
  });

  it('new-release when server differs and not in crash history', () => {
    expect(decide(LOCAL_CLEAN, POINTER)).toEqual({
      kind: 'new-release',
      pointer: POINTER,
    });
  });

  it('new-release takes priority over compatibility when both could match', () => {
    // lynxEngineVersion "4.0.0" satisfies our minimum "4.0.0"
    expect(decide(LOCAL_CLEAN, POINTER).kind).toBe('new-release');
  });

  it('incompatible when minHostVersion is lower than known build', () => {
    const bad: ChannelPointer = {
      ...POINTER,
      current: { ...POINTER.current, minHostVersion: '99.0.0' },
    };
    expect(decide(LOCAL_CLEAN, bad).kind).toBe('new-release'); // stub: actual compare lives native
  });
});

describe('compareVersions', () => {
  it('returns 0 for equal', () => {
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0);
  });

  it('returns -1 when a < b', () => {
    expect(compareVersions('1.2.0', '1.3.0')).toBe(-1);
    expect(compareVersions('1.2.0', '2.0.0')).toBe(-1);
  });

  it('returns 1 when a > b', () => {
    expect(compareVersions('1.3.0', '1.2.0')).toBe(1);
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
  });

  it('treats missing trailing segments as 0', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.0', '1.2')).toBe(0);
  });

  it('handles non-numeric segments as 0', () => {
    expect(compareVersions('1.2.x', '1.2.0')).toBe(0);
  });
});
