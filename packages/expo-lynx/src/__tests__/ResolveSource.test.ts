import { resolveSource } from '../ResolveSource';

describe('resolveSource', () => {
  it('passes embedded through both debug and release', () => {
    const s = { kind: 'embedded' as const, feature: 'delivery' };
    expect(resolveSource(s, 'debug')).toEqual(s);
    expect(resolveSource(s, 'release')).toEqual(s);
  });

  it('passes managed through both debug and release', () => {
    const s = { kind: 'managed' as const, feature: 'delivery' };
    expect(resolveSource(s, 'debug')).toEqual(s);
    expect(resolveSource(s, 'release')).toEqual(s);
  });

  it('passes development through in debug', () => {
    const s = {
      kind: 'development' as const,
      url: 'http://192.168.1.1:3000/main.lynx.bundle',
    };
    expect(resolveSource(s, 'debug')).toEqual(s);
  });

  it('throws on development in release', () => {
    const s = {
      kind: 'development' as const,
      url: 'http://192.168.1.1:3000/main.lynx.bundle',
    };
    expect(() => resolveSource(s, 'release')).toThrow(/development source is forbidden/);
  });
});
