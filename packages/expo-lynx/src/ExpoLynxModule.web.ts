import type { LynxBundleUpdateResult } from './ExpoLynx.types';
import type { LynxBundleUpdateOptions } from './ExpoLynxModule';

const ExpoLynxModule = {
  async checkForUpdate(_options: LynxBundleUpdateOptions): Promise<LynxBundleUpdateResult> {
    throw new Error(
      'expo-lynx-view: managed bundle delivery is currently implemented on iOS only.'
    );
  },

  // No runtime to warm on web; resolve silently so callers can call it
  // unconditionally on app start.
  async prewarmRuntime(): Promise<void> {},
};

export default ExpoLynxModule;
