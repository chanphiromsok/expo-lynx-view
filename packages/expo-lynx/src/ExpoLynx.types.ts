import type { NativeSyntheticEvent, ViewProps } from 'react-native';

import type { LynxErrorStage, LynxSource, LynxUpdateEvent } from './LynxSource';

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
export type LynxUpdateEventPayload = LynxUpdateEvent;

export type LynxBundleUpdateResult =
  | {
      feature: string;
      status: 'disabled' | 'no-update';
      revision?: number;
    }
  | {
      feature: string;
      status: 'pending' | 'reloaded';
      revision: number;
      releaseId: string;
      version: string;
    };

type ExpoLynxViewBaseProps = Omit<ViewProps, 'children'> & {
  /** Data exposed to the Lynx page through `useInitData()`. */
  initialData?: LynxInitialData;
  /** Fires immediately before Lynx starts loading/rendering the selected bundle. */
  onLoadStart?: (event: NativeSyntheticEvent<LynxLoadEventPayload>) => void;
  /** Fires once Lynx completes the selected bundle's first-screen layout. */
  onLoad?: (event: NativeSyntheticEvent<LynxLoadEventPayload>) => void;
  /** Fires for delivery, verification, resource, and Lynx rendering failures. */
  onError?: (event: NativeSyntheticEvent<LynxErrorEventPayload>) => void;
  /**
   * Reports managed-delivery checking, staging, and verified force reloads.
   */
  onUpdate?: (event: NativeSyntheticEvent<LynxUpdateEventPayload>) => void;
  children?: never;
};

type ExpoLynxManagedSourceProps = {
  /** Declarative source. Managed delivery is implemented on iOS and Android. */
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
};
