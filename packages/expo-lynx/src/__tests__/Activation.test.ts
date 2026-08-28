import { decideActivation, type StagedRelease } from '../Activation';

const STAGED: StagedRelease = {
  feature: 'delivery',
  versionId: 'v2',
  manifestSha256: 'v2-sha',
  stagedAt: '2026-08-27T10:00:00Z',
};

describe('decideActivation', () => {
  it('skips when no staged release', () => {
    expect(decideActivation(null, 'on-launch')).toEqual({
      kind: 'skip',
      reason: 'no-staged-release',
    });
    expect(decideActivation(null, 'next-open')).toEqual({
      kind: 'skip',
      reason: 'no-staged-release',
    });
  });

  it('skips when mode is not declared', () => {
    expect(decideActivation(STAGED, undefined)).toEqual({
      kind: 'skip',
      reason: 'no-mode-declared',
    });
  });

  it('reload-now when mode is on-launch', () => {
    expect(decideActivation(STAGED, 'on-launch')).toEqual({
      kind: 'reload-now',
      release: STAGED,
    });
  });

  it('stage-for-next-launch when mode is next-open', () => {
    expect(decideActivation(STAGED, 'next-open')).toEqual({
      kind: 'stage-for-next-launch',
      release: STAGED,
    });
  });
});
