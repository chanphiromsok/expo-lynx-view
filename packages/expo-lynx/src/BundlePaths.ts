// Legacy prototype paths; V2 migration target: M10 cache and recovery.
//
// Spec: feature/delivery-bundle-update/specs/v2/mobile/m10-cache-disk-recovery.md
//
// The atomic-rename logic and actor live in ios/LynxBundleStore.swift
// (Swift actor). This file holds the pure path-naming helpers so JS
// can read the same layout (e.g. for the last-known-good pointer).

/**
 * Layout:
 *   <root>/staging/<uuid>/                  ← in-progress, deleted on failure
 *   <root>/ready/<feature>/<versionId>/     ← verified, atomic-renamed from staging
 *   <root>/last_known_good                  ← one-line pointer: <feature>/<versionId>
 */

export type BundlePaths = {
  root: string;
  stagingDir: (uuid: string) => string;
  readyDir: (feature: string, versionId: string) => string;
  readyBundleFile: (feature: string, versionId: string) => string;
  lkgPointerFile: string;
};

export function makeBundlePaths(root: string): BundlePaths {
  return {
    root,
    stagingDir: (uuid: string) => `${root}/staging/${uuid}`,
    readyDir: (feature: string, versionId: string) => `${root}/ready/${feature}/${versionId}`,
    readyBundleFile: (feature: string, versionId: string) =>
      `${root}/ready/${feature}/${versionId}/main.lynx.bundle`,
    lkgPointerFile: `${root}/last_known_good`,
  };
}

/** Allocate a new staging UUID. Each download lives in its own dir.
 *  Uses crypto.randomUUID() which is available in Hermes JS runtime. */
export function newStagingId(): string {
  // Hermes supports crypto.randomUUID as of RN 0.74+.
  // Fallback to Math.random() hex for older runtimes.
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // RFC 4122 v4 fallback — sufficient for unique staging dirs.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Parse a last-known-good pointer file. Format: `<feature>/<versionId>`. */
export function parseLkgPointer(text: string): { feature: string; versionId: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const [feature, versionId] = trimmed.split('/');
  if (!feature || !versionId) return null;
  return { feature, versionId };
}

/** Serialize a last-known-good pointer file. */
export function formatLkgPointer(feature: string, versionId: string): string {
  return `${feature}/${versionId}\n`;
}
