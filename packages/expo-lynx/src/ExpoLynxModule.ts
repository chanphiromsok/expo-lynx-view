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
   *
   * **iOS only.** On Android this resolves immediately without doing anything:
   * the native module does not register `prewarmRuntime`, so Android still pays
   * engine init at first mount. See `docs/android-parity.md` (A02) — a real
   * Android warm-up is deferred to separate performance work.
   */
  prewarmRuntime(): Promise<void> {
    // Enforce the documented "iOS only" contract. The Android native module
    // registers module-scoped `checkForUpdate`, the view-scoped `reload`, and
    // the view's props/events — but not `prewarmRuntime` — so an unconditional
    // call would reject with "nativeModule.prewarmRuntime is not a function".
    // A capability check (not a Platform check) stays correct if Android later
    // gains the function.
    if (typeof nativeModule.prewarmRuntime !== 'function') {
      return Promise.resolve();
    }
    return nativeModule.prewarmRuntime();
  },
};

export default ExpoLynxModule;
