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

type ExpoLynxViewBaseProps = Omit<ViewProps, 'children'> & {
  /** Data exposed to the Lynx page through `useInitData()`. */
  initialData?: LynxInitialData;
  /** Fires immediately before Lynx starts loading/rendering the selected bundle. */
  onLoadStart?: (event: NativeSyntheticEvent<LynxLoadEventPayload>) => void;
  /** Fires only after Lynx successfully renders the selected bundle. */
  onLoad?: (event: NativeSyntheticEvent<LynxLoadEventPayload>) => void;
  /** Fires for delivery, verification, resource, and Lynx rendering failures. */
  onError?: (event: NativeSyntheticEvent<LynxErrorEventPayload>) => void;
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
};
