// Legacy prototype source guard; V2 migration target: M05 prefetch/source API.
//
// Spec: feature/delivery-bundle-update/specs/v2/mobile/m05-prefetch-progress-api.md
//
// The native enforcement lives in ios/View/ExpoLynxView.swift. This file
// holds the JS-side contract so the prop type can be narrowed before
// the native layer sees it.

import type { LynxSource } from './LynxSource';

export type BuildMode = 'debug' | 'release';

/**
 * Resolve a `LynxSource` against the current build mode.
 *
 * Rules:
 * - Debug: pass through (development urls, raw https, anything allowed).
 * - Release: `development` is forbidden; `embedded`/`managed` pass.
 *
 * Throws on forbidden combinations in Release builds.
 */
export function resolveSource(source: LynxSource, mode: BuildMode): LynxSource {
  if (mode === 'release' && source.kind === 'development') {
    throw new Error(
      'expo-lynx-view: development source is forbidden in Release builds. ' +
        'Use kind: "managed" with a verified channel pointer.'
    );
  }
  return source;
}
