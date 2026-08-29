import { NativeModule, requireNativeModule } from 'expo';

import type { LynxBundleUpdateResult } from './ExpoLynx.types';
import type { LynxFeatureName } from './LynxSource';

export type LynxBundleUpdateOptions = {
  feature: LynxFeatureName;
  channel?: 'stable' | 'beta';
};

declare class NativeExpoLynxModule extends NativeModule {
  checkForUpdate(
    feature: LynxFeatureName,
    channel?: 'stable' | 'beta'
  ): Promise<LynxBundleUpdateResult>;
}

const nativeModule = requireNativeModule<NativeExpoLynxModule>('ExpoLynx');

/**
 * Native delivery resolution accepts only a feature/channel pair. The endpoint
 * comes from the plugin-generated Info.plist map, not from this API.
 */
const ExpoLynxModule = {
  checkForUpdate(options: LynxBundleUpdateOptions): Promise<LynxBundleUpdateResult> {
    return nativeModule.checkForUpdate(options.feature, options.channel);
  },
};

export default ExpoLynxModule;
