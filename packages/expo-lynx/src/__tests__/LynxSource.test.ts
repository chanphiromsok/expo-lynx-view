import type { LynxSource, LynxLoadEvent, LynxErrorEvent, LynxErrorStage } from '../LynxSource';

describe('LynxSource contract', () => {
  it('accepts embedded source with feature name', () => {
    const s: LynxSource = { kind: 'embedded', feature: 'delivery' };
    expect(s.kind).toBe('embedded');
    if (s.kind === 'embedded') {
      expect(s.feature).toBe('delivery');
    }
  });

  it('accepts managed source with default channel and on-launch activation', () => {
    const s: LynxSource = {
      kind: 'managed',
      feature: 'delivery',
      channel: 'stable',
      activation: 'on-launch',
    };
    expect(s.kind).toBe('managed');
    if (s.kind === 'managed') {
      expect(s.channel).toBe('stable');
      expect(s.activation).toBe('on-launch');
    }
  });

  it('accepts managed source with next-open activation', () => {
    const s: LynxSource = {
      kind: 'managed',
      feature: 'delivery',
      channel: 'beta',
      activation: 'next-open',
    };
    if (s.kind === 'managed') {
      expect(s.activation).toBe('next-open');
    }
  });

  it('accepts a Debug-only direct manifest URL for local testing', () => {
    const s: LynxSource = {
      kind: 'managed',
      feature: 'delivery',
      manifestUrl: 'http://127.0.0.1:3017/manifest.json',
    };
    if (s.kind === 'managed') {
      expect(s.manifestUrl).toContain('manifest.json');
    }
  });

  it('accepts a signed channel URL for conditional update checks', () => {
    const s: LynxSource = {
      kind: 'managed',
      feature: 'delivery',
      channel: 'stable',
      channelUrl: 'http://127.0.0.1:3017/v1/channels/delivery/stable',
    };
    if (s.kind === 'managed') {
      expect(s.channelUrl).toContain('/v1/channels/delivery/stable');
    }
  });

  it('omitting channel and activation is valid (defaults applied at runtime)', () => {
    const s: LynxSource = { kind: 'managed', feature: 'delivery' };
    if (s.kind === 'managed') {
      expect(s.channel).toBeUndefined();
      expect(s.activation).toBeUndefined();
    }
  });

  it('accepts development source with url', () => {
    const s: LynxSource = {
      kind: 'development',
      url: 'http://192.168.1.1:3000/main.lynx.bundle',
    };
    if (s.kind === 'development') {
      expect(s.url).toContain('main.lynx.bundle');
    }
  });
});

describe('LynxLoadEvent', () => {
  it('has all required fields', () => {
    const e: LynxLoadEvent = {
      feature: 'delivery',
      version: '2026.08.27.1',
      source: 'download',
      durationMs: 1234,
    };
    expect(e.feature).toBe('delivery');
    expect(e.version).toBe('2026.08.27.1');
    expect(e.source).toBe('download');
    expect(e.durationMs).toBe(1234);
  });

  it('source must be one of embedded | cache | download | development', () => {
    const sources: LynxLoadEvent['source'][] = ['embedded', 'cache', 'download', 'development'];
    sources.forEach((source) => {
      const e: LynxLoadEvent = {
        feature: 'f',
        version: '1',
        source,
        durationMs: 0,
      };
      expect(sources).toContain(e.source);
    });
  });
});

describe('LynxErrorEvent', () => {
  it('stage covers the full enum', () => {
    const stages: LynxErrorStage[] = [
      'manifest',
      'signature',
      'compatibility',
      'download',
      'checksum',
      'resource',
      'lynx',
    ];
    stages.forEach((stage) => {
      const e: LynxErrorEvent = {
        feature: 'f',
        stage,
        code: 'E_TEST',
        message: 'msg',
      };
      expect(e.stage).toBe(stage);
    });
  });

  it("'crash_history' is not yet a defined stage (lands with PR6)", () => {
    const stages: LynxErrorStage[] = [
      'manifest',
      'signature',
      'compatibility',
      'download',
      'checksum',
      'resource',
      'lynx',
    ];
    expect(stages).not.toContain('crash_history');
  });
});
