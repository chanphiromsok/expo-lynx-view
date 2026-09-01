import type { LynxSource, LynxLoadEvent, LynxErrorEvent, LynxErrorStage } from '../LynxSource';

describe('LynxSource contract', () => {
  it('accepts embedded source with feature name', () => {
    const s: LynxSource = { kind: 'embedded', feature: 'delivery' };
    expect(s.kind).toBe('embedded');
    if (s.kind === 'embedded') {
      expect(s.feature).toBe('delivery');
    }
  });

  it('accepts a feature-only managed deployment', () => {
    const s: LynxSource = { kind: 'managed', feature: 'delivery' };
    expect(s.kind).toBe('managed');
    if (s.kind === 'managed') {
      expect(s.feature).toBe('delivery');
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
      'archive',
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
      'archive',
      'lynx',
    ];
    expect(stages).not.toContain('crash_history');
  });
});
