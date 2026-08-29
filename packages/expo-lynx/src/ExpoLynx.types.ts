import type { NativeSyntheticEvent, ViewProps } from 'react-native';

import type { LynxErrorStage, LynxSource } from './LynxSource';

export type LynxInitialData = Record<string, unknown>;

export type LynxLoadEventPayload = {
  url: string;
  feature: string;
  version: string;
  source: 'embedded' | 'cache' | 'download' | 'development';
  durationMs: number;
};

export type LynxErrorEventPayload = {
  url: string;
  feature: string;
  stage: LynxErrorStage;
  code: string;
  message: string;
  version?: string;
  source?: LynxLoadEventPayload['source'];
  durationMs?: number;
};

/**
 * A delivery lifecycle event. It deliberately excludes network URLs, headers,
 * local paths, and bundle contents so it is safe to forward to product
 * analytics after the app applies its own privacy policy.
 */
export type LynxUpdateEventPayload = {
  feature: string;
  channel: 'stable' | 'beta';
  phase: 'checking' | 'no-update' | 'downloaded' | 'staged' | 'error';
  releaseId?: string;
  version?: string;
  revision?: number;
  code?: string;
  message?: string;
};

export type LynxBundleUpdateResult = {
  feature: string;
  channel: 'stable' | 'beta';
  status: 'no-update' | 'downloaded' | 'pending';
  releaseId?: string;
  version?: string;
};

type ExpoLynxViewBaseProps = Omit<ViewProps, 'children'> & {
  /** Data exposed to the Lynx page through `useInitData()`. */
  initialData?: LynxInitialData;
  /** Fires immediately before Lynx starts loading/rendering the selected bundle. */
  onLoadStart?: (event: NativeSyntheticEvent<LynxLoadEventPayload>) => void;
  /** Fires only after Lynx successfully renders the selected bundle. */
  onLoad?: (event: NativeSyntheticEvent<LynxLoadEventPayload>) => void;
  /** Fires for delivery, verification, resource, and Lynx rendering failures. */
  onError?: (event: NativeSyntheticEvent<LynxErrorEventPayload>) => void;
  /**
   * Reports a non-blocking managed-delivery check. It never means the mounted
   * Lynx page was replaced; a downloaded release is staged for a later open.
   */
  onUpdate?: (event: NativeSyntheticEvent<LynxUpdateEventPayload>) => void;
  children?: never;
};

type ExpoLynxManagedSourceProps = {
  /** Declarative source. Managed delivery is currently implemented on iOS. */
  source: LynxSource;
  url?: never;
};

type ExpoLynxLegacySourceProps = {
  /** @deprecated Prefer `source`. Raw remote URLs are accepted only by Debug iOS builds. */
  url: string;
  source?: never;
};

export type ExpoLynxViewProps = ExpoLynxViewBaseProps &
  (ExpoLynxManagedSourceProps | ExpoLynxLegacySourceProps);

export type ExpoLynxViewRef = {
  reload(): Promise<void>;
  /**
   * Explicitly revalidates this managed source's signed channel. The native
   * side owns its configured endpoint, ETag, trust roots, and cache.
   */
  checkForUpdate(): Promise<LynxBundleUpdateResult>;
};
