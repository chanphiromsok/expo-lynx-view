// Legacy prototype manifest; V2 migration target: M01 shared protocol.
//
// Spec: feature/delivery-bundle-update/specs/v2/mobile/m01-shared-release-protocol.md
//
// Full SHA-256 verification lives in ios/LynxManifest.swift and
// android/.../LynxManifest.kt. This file holds the JSON contract
// only, so JS code that touches manifests can use the same shape.
//
// SHA-256 helpers are deliberately NOT reimplemented in JS — the
// canonical implementation is native, and duplicating it in JS would
// invite drift.

export type ManifestBundle = {
  url: string;
  sha256: string;
  bytes: number;
};

export type ManifestResource = {
  path: string;
  url: string;
  sha256: string;
  bytes: number;
};

export type Manifest = {
  feature: string;
  version: string;
  minHostVersion: string;
  lynxEngineVersion: string;
  bundle: ManifestBundle;
  resources: ManifestResource[];
  signature: string; // Legacy opaque field; V2 replaces this manifest contract.
};

/**
 * Parse a manifest JSON string into the typed shape. Throws on
 * missing required fields. Does NOT verify hash/signature.
 */
export function parseManifest(json: string): Manifest {
  const obj = JSON.parse(json);
  if (
    typeof obj.feature !== 'string' ||
    typeof obj.version !== 'string' ||
    typeof obj.minHostVersion !== 'string' ||
    typeof obj.lynxEngineVersion !== 'string' ||
    !obj.bundle ||
    typeof obj.bundle.url !== 'string' ||
    typeof obj.bundle.sha256 !== 'string' ||
    typeof obj.bundle.bytes !== 'number' ||
    !Array.isArray(obj.resources) ||
    typeof obj.signature !== 'string'
  ) {
    throw new Error('manifest JSON missing required fields');
  }
  return obj as Manifest;
}
