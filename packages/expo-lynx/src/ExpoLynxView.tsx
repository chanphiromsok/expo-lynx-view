import { requireNativeView } from 'expo';
import { forwardRef } from 'react';
import type { ComponentType, RefAttributes } from 'react';

import type { ExpoLynxViewProps, ExpoLynxViewRef } from './ExpoLynx.types';

type NativeExpoLynxViewProps = Omit<ExpoLynxViewProps, 'initialData'> & {
  initialDataJSON?: string;
};

const NativeView = requireNativeView<NativeExpoLynxViewProps>('ExpoLynx') as ComponentType<
  NativeExpoLynxViewProps & RefAttributes<ExpoLynxViewRef>
>;

const ExpoLynxView = forwardRef<ExpoLynxViewRef, ExpoLynxViewProps>(
  ({ initialData, ...props }, ref) => {
    const initialDataJSON = initialData === undefined ? undefined : JSON.stringify(initialData);

    return <NativeView ref={ref} initialDataJSON={initialDataJSON} {...props} />;
  }
);

ExpoLynxView.displayName = 'ExpoLynxView';

export default ExpoLynxView;
