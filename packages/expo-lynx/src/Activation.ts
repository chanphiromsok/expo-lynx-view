// Legacy prototype activation helper; V2 migration target: M06.
//
// Spec: feature/delivery-bundle-update/specs/v2/mobile/m06-safe-activation-recovery.md
//
// This is a pure decision function: given the staged release and
// the channel's declared activation mode, decide whether to reload
// in this launch or stage for next.

type ActivationMode = 'on-launch' | 'next-open';

export type StagedRelease = {
  feature: string;
  versionId: string;
  manifestSha256: string;
  stagedAt: string;
};

export type ActivationDecision =
  | { kind: 'reload-now'; release: StagedRelease }
  | { kind: 'stage-for-next-launch'; release: StagedRelease }
  | { kind: 'skip'; reason: 'no-staged-release' | 'no-mode-declared' };

export function decideActivation(
  staged: StagedRelease | null,
  mode: ActivationMode | undefined
): ActivationDecision {
  if (staged === null) return { kind: 'skip', reason: 'no-staged-release' };
  if (mode === undefined) return { kind: 'skip', reason: 'no-mode-declared' };
  if (mode === 'on-launch') return { kind: 'reload-now', release: staged };
  return { kind: 'stage-for-next-launch', release: staged };
}
