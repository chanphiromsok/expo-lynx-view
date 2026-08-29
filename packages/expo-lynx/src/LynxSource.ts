export type ActivationMode = 'on-launch' | 'next-open';

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
      channel?: 'stable' | 'beta';
      activation?: ActivationMode;
      /** Signed channel-envelope endpoint used for ETag update checks. */
      channelUrl?: string;
      /** Debug-only direct signed release-envelope endpoint for local testing. */
      manifestUrl?: string;
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

export type LynxUpdatePhase = 'checking' | 'no-update' | 'downloaded' | 'staged' | 'error';

/** Privacy-safe, lifecycle-level delivery telemetry for a managed source. */
export type LynxUpdateEvent = {
  feature: string;
  channel: 'stable' | 'beta';
  phase: LynxUpdatePhase;
  releaseId?: string;
  version?: string;
  revision?: number;
  code?: string;
  message?: string;
  durationMs?: number;
};
