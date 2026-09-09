import { NativeModule, requireNativeModule } from 'expo';

import type { LynxBundleUpdateResult } from './ExpoLynx.types';
import type { LynxFeatureName } from './LynxSource';

export type LynxBundleUpdateOptions = {
  feature: LynxFeatureName;
};

declare class NativeExpoLynxModule extends NativeModule {
  checkForUpdate(feature: LynxFeatureName): Promise<LynxBundleUpdateResult>;
  prewarmRuntime(): Promise<void>;
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

  /**
   * Build the background JS runtime (engine + lynx_core.js) ahead of the first
   * `ExpoLynxView` mount, so the mount attaches to a live runtime instead of
   * paying JSC init + framework eval on the Lynx_JS thread.
   *
   * Call once the app is interactive — e.g. inside
   * `InteractionManager.runAfterInteractions(...)` after the splash screen
   * hides — so the work never competes with app launch. Runs off the main
   * thread; calling it more than once is a no-op while a build is in flight.
   * No-op on platforms other than iOS.
   */
  prewarmRuntime(): Promise<void> {
    return nativeModule.prewarmRuntime();
  },
};

export default ExpoLynxModule;
