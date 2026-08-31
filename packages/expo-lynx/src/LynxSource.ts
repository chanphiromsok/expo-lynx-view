/**
 * Augmented by the app-local `generated/expo-lynx/lynx-features.d.ts` file
 * written by the Expo config plugin during prebuild.
 *
 * The empty base keeps `expo-lynx` usable by libraries and by applications
 * before their first prebuild. Once generated, `LynxFeatureName` becomes the
 * exact union of configured feature IDs and editors can autocomplete them.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- apps augment this interface at prebuild time.
export interface ExpoLynxFeatureMap {}

type ConfiguredLynxFeatureName = Extract<keyof ExpoLynxFeatureMap, string>;

export type LynxFeatureName = [ConfiguredLynxFeatureName] extends [never]
  ? string
  : ConfiguredLynxFeatureName;

export type LynxSource =
  | { kind: 'embedded'; feature: LynxFeatureName }
  | {
      kind: 'managed';
      feature: LynxFeatureName;
    }
  | { kind: 'development'; url: string };

export type LynxLoadEvent = {
  feature: string;
  version: string;
  source: 'embedded' | 'cache' | 'download' | 'development';
  durationMs: number;
};

export type LynxErrorStage =
  'manifest' | 'signature' | 'compatibility' | 'download' | 'checksum' | 'resource' | 'lynx';

export type LynxErrorEvent = {
  feature: string;
  stage: LynxErrorStage;
  code: string;
  message: string;
};

export type LynxUpdatePhase =
  'checking' | 'disabled' | 'no-update' | 'downloaded' | 'staged' | 'reloading' | 'reloaded' | 'error';

/** Privacy-safe, lifecycle-level delivery telemetry for a managed source. */
export type LynxUpdateEvent = {
  feature: string;
  phase: LynxUpdatePhase;
  releaseId?: string;
  version?: string;
  revision?: number;
  code?: string;
  message?: string;
  durationMs?: number;
};
