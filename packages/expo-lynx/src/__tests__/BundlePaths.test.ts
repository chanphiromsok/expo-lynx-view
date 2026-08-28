import { makeBundlePaths, newStagingId, parseLkgPointer, formatLkgPointer } from '../BundlePaths';

describe('makeBundlePaths', () => {
  it('produces the canonical layout under any root', () => {
    const p = makeBundlePaths('/var/mobile/Containers/Data/Application/abc/Library/Caches');
    expect(p.stagingDir('uuid-1')).toBe(
      '/var/mobile/Containers/Data/Application/abc/Library/Caches/staging/uuid-1'
    );
    expect(p.readyDir('delivery', 'v2')).toBe(
      '/var/mobile/Containers/Data/Application/abc/Library/Caches/ready/delivery/v2'
    );
    expect(p.readyBundleFile('delivery', 'v2')).toBe(
      '/var/mobile/Containers/Data/Application/abc/Library/Caches/ready/delivery/v2/main.lynx.bundle'
    );
    expect(p.lkgPointerFile).toBe(
      '/var/mobile/Containers/Data/Application/abc/Library/Caches/last_known_good'
    );
  });
});

describe('newStagingId', () => {
  it('returns a UUID-shaped string', () => {
    const id = newStagingId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('returns unique IDs across calls', () => {
    const ids = new Set([newStagingId(), newStagingId(), newStagingId(), newStagingId()]);
    expect(ids.size).toBe(4);
  });
});

describe('parseLkgPointer', () => {
  it('parses feature/versionId', () => {
    expect(parseLkgPointer('delivery/v2')).toEqual({ feature: 'delivery', versionId: 'v2' });
    expect(parseLkgPointer('delivery/v2\n')).toEqual({ feature: 'delivery', versionId: 'v2' });
  });

  it('returns null on empty', () => {
    expect(parseLkgPointer('')).toBeNull();
    expect(parseLkgPointer('   ')).toBeNull();
  });

  it('returns null on malformed (no slash)', () => {
    expect(parseLkgPointer('delivery')).toBeNull();
  });

  it('returns null on malformed (empty fields)', () => {
    expect(parseLkgPointer('/v2')).toBeNull();
    expect(parseLkgPointer('delivery/')).toBeNull();
  });
});

describe('formatLkgPointer', () => {
  it('round-trips through parseLkgPointer', () => {
    const cases: [string, string][] = [
      ['delivery', 'v2'],
      ['cart', '2026.08.27.1'],
      ['settings', 'sha256hexstring'],
    ];
    cases.forEach(([feature, versionId]) => {
      const text = formatLkgPointer(feature, versionId);
      expect(parseLkgPointer(text)).toEqual({ feature, versionId });
    });
  });
});
