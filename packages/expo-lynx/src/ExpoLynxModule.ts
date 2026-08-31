import { NativeModule, requireNativeModule } from 'expo';

import type { LynxBundleUpdateResult } from './ExpoLynx.types';
import type { LynxFeatureName } from './LynxSource';

export type LynxBundleUpdateOptions = {
  feature: LynxFeatureName;
};

declare class NativeExpoLynxModule extends NativeModule {
  checkForUpdate(feature: LynxFeatureName): Promise<LynxBundleUpdateResult>;
}

const nativeModule = requireNativeModule<NativeExpoLynxModule>('ExpoLynx');

/**
 * Native delivery resolution accepts only a feature. The endpoint
 * comes from the plugin-generated Info.plist map, not from this API.
 */
const ExpoLynxModule = {
  checkForUpdate(options: LynxBundleUpdateOptions): Promise<LynxBundleUpdateResult> {
    return nativeModule.checkForUpdate(options.feature);
  },
};

export default ExpoLynxModule;
