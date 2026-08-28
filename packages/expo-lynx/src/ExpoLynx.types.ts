import type { NativeSyntheticEvent, ViewProps } from 'react-native';

export type LynxInitialData = Record<string, unknown>;

export type LynxLoadEventPayload = {
  url: string;
};

export type LynxErrorEventPayload = LynxLoadEventPayload & {
  code: string;
  message: string;
};

export type ExpoLynxViewProps = Omit<ViewProps, 'children'> & {
  /** HTTPS URL, file URL, or bundled resource name for a compiled `.lynx.bundle`. */
  url: string;
  /** Data exposed to the Lynx page through `useInitData()`. */
  initialData?: LynxInitialData;
  onLoadStart?: (event: NativeSyntheticEvent<LynxLoadEventPayload>) => void;
  onLoad?: (event: NativeSyntheticEvent<LynxLoadEventPayload>) => void;
  onError?: (event: NativeSyntheticEvent<LynxErrorEventPayload>) => void;
  children?: never;
};

export type ExpoLynxViewRef = {
  reload(): Promise<void>;
};
