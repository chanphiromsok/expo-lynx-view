// Legacy prototype channel state; V2 migration target: M06 activation/recovery.
//
// Spec: feature/delivery-bundle-update/specs/v2/mobile/m06-safe-activation-recovery.md
//
// The actual UserDefaults / SharedPreferences live in iOS/Android native.
// This file holds the JS-visible shape + the comparison logic so the
// RN side can decide "should I download?" without trusting the server.

export type ChannelState = {
  feature: string;
  channel: string;
  last_manifest_id: string | null; // SHA-256 hex of the last applied manifest
  last_checked_at: string | null; // ISO-8601
  last_etag: string | null;
  applied_at: string | null; // ISO-8601
  crash_history: string[]; // manifest IDs known to crash (PR7)
};

export type ChannelPointer = {
  channel: string;
  feature: string;
  current: {
    manifestUrl: string;
    manifestSha256: string;
    minHostVersion: string;
    lynxEngineVersion: string;
  };
  issuedAt: string;
};

export type UpdateDecision =
  | { kind: 'first-launch' } // no local state yet
  | { kind: 'already-current' } // local matches server
  | { kind: 'in-crash-history'; manifestId: string } // skip per PR6 contract
  | { kind: 'incompatible'; minHostVersion: string; lynxEngineVersion: string }
  | { kind: 'new-release'; pointer: ChannelPointer };

/**
 * Decide what to do given the server's pointer + the local channel
 * state. Pure function; no I/O.
 */
export function decide(local: ChannelState | null, server: ChannelPointer): UpdateDecision {
  if (local === null) {
    return { kind: 'first-launch' };
  }

  if (server.current.manifestSha256 === local.last_manifest_id) {
    return { kind: 'already-current' };
  }

  if (local.crash_history.includes(server.current.manifestSha256)) {
    return {
      kind: 'in-crash-history',
      manifestId: server.current.manifestSha256,
    };
  }

  // Compatibility check stub — full version comparison belongs in native.
  // In production, `parseVersion(server.current.minHostVersion)` etc.
  // Here we surface a marker for the native side to evaluate.
  const minHostOk = compareVersions(server.current.minHostVersion, '0') >= 0;
  const lynxEngineOk = compareVersions(server.current.lynxEngineVersion, '4.0.0') >= 0;
  if (!minHostOk || !lynxEngineOk) {
    return {
      kind: 'incompatible',
      minHostVersion: server.current.minHostVersion,
      lynxEngineVersion: server.current.lynxEngineVersion,
    };
  }

  return { kind: 'new-release', pointer: server };
}

/** Minimal semver compare. Returns -1 / 0 / 1. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((s) => parseInt(s, 10) || 0);
  const pb = b.split('.').map((s) => parseInt(s, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}
