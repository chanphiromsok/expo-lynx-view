import { parseManifest } from '../Manifest';

const SAMPLE_MANIFEST = JSON.stringify({
  feature: 'delivery',
  version: '2026.08.27.1',
  minHostVersion: '1.2.0',
  lynxEngineVersion: '4.0.0',
  bundle: {
    url: 'https://cdn.example.com/lynx/delivery/abc123/main.lynx.bundle',
    sha256: 'f4c1deadbeef0000000000000000000000000000000000000000000000000000',
    bytes: 321726,
  },
  resources: [
    {
      path: 'static/image/logo.png',
      url: 'https://cdn.example.com/lynx/delivery/abc123/static/image/logo.png',
      sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      bytes: 1245,
    },
  ],
  signature: 'legacyOpaqueSignature==',
});

describe('parseManifest', () => {
  it('round-trips a valid manifest JSON', () => {
    const m = parseManifest(SAMPLE_MANIFEST);
    expect(m.feature).toBe('delivery');
    expect(m.version).toBe('2026.08.27.1');
    expect(m.minHostVersion).toBe('1.2.0');
    expect(m.lynxEngineVersion).toBe('4.0.0');
    expect(m.bundle.url).toContain('main.lynx.bundle');
    expect(m.bundle.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(m.bundle.bytes).toBe(321726);
    expect(m.resources).toHaveLength(1);
    expect(m.resources[0].path).toBe('static/image/logo.png');
    expect(m.signature).toBe('legacyOpaqueSignature==');
  });

  it('throws on missing feature', () => {
    const bad = JSON.stringify({ ...JSON.parse(SAMPLE_MANIFEST), feature: undefined });
    expect(() => parseManifest(bad)).toThrow(/missing required fields/);
  });

  it('throws on missing bundle', () => {
    const bad = JSON.stringify({ ...JSON.parse(SAMPLE_MANIFEST), bundle: undefined });
    expect(() => parseManifest(bad)).toThrow(/missing required fields/);
  });

  it('throws on non-string signature', () => {
    const bad = JSON.stringify({ ...JSON.parse(SAMPLE_MANIFEST), signature: 12345 });
    expect(() => parseManifest(bad)).toThrow(/missing required fields/);
  });

  it('throws on non-array resources', () => {
    const bad = JSON.stringify({ ...JSON.parse(SAMPLE_MANIFEST), resources: 'nope' });
    expect(() => parseManifest(bad)).toThrow(/missing required fields/);
  });

  it('throws on malformed JSON', () => {
    expect(() => parseManifest('not json')).toThrow();
  });
});
