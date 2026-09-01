import { requireNativeView } from 'expo';
import { forwardRef } from 'react';
import type { ComponentType, RefAttributes } from 'react';
import { Platform } from 'react-native';

import type { ExpoLynxViewProps, ExpoLynxViewRef } from './ExpoLynx.types';

type NativeExpoLynxViewProps = Omit<ExpoLynxViewProps, 'initialData' | 'source'> & {
  initialDataJSON?: string;
  sourceJSON?: string;
  url?: string;
};

const NativeView = requireNativeView<NativeExpoLynxViewProps>('ExpoLynx') as ComponentType<
  NativeExpoLynxViewProps & RefAttributes<ExpoLynxViewRef>
>;

const ExpoLynxView = forwardRef<ExpoLynxViewRef, ExpoLynxViewProps>(
  ({ initialData, source, url, ...props }, ref) => {
    const initialDataJSON = initialData === undefined ? undefined : JSON.stringify(initialData);
    let nativeURL = url;
    let sourceJSON: string | undefined;

    if (source) {
      if (Platform.OS === 'ios') {
        sourceJSON = JSON.stringify(source);
      } else if (source.kind === 'development') {
        nativeURL = source.url;
      } else if (source.kind === 'embedded') {
        nativeURL = 'static.lynx';
      } else {
        throw new Error(
          'expo-lynx-view: managed bundle delivery is currently implemented on iOS only.'
        );
      }
    }

    return (
      <NativeView
        ref={ref}
        initialDataJSON={initialDataJSON}
        sourceJSON={sourceJSON}
        url={nativeURL}
        {...props}
      />
    );
  }
);

ExpoLynxView.displayName = 'ExpoLynxView';

export default ExpoLynxView;
