import type { LynxBundleUpdateResult } from './ExpoLynx.types';
import type { LynxBundleUpdateOptions } from './ExpoLynxModule';

const ExpoLynxModule = {
  async checkForUpdate(_options: LynxBundleUpdateOptions): Promise<LynxBundleUpdateResult> {
    throw new Error(
      'expo-lynx-view: managed bundle delivery is currently implemented on iOS only.'
    );
  },
};

export default ExpoLynxModule;
