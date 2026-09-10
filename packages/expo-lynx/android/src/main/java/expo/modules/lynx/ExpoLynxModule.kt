package expo.modules.lynx

import android.app.Application
import com.lynx.service.http.LynxHttpService
import com.lynx.service.log.LynxLogService
import com.lynx.tasm.LynxEnv
import com.lynx.tasm.service.LynxServiceCenter
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import expo.modules.lynx.delivery.ManagedDeliveryCoordinator

class ExpoLynxModule : Module() {
  // C2 (#17): no `@RequiresApi`. The effective merged `minSdk` is 24 (RN 0.86
  // default, per the `ExpoRootProject` version block); nothing in this module
  // or `definition()` calls an API above it. The previous
  // `@RequiresApi(Build.VERSION_CODES.P)` annotated a floor the module did not
  // enforce.
  override fun definition() = ModuleDefinition {
    Name("ExpoLynx")

    OnCreate {
      val application = appContext.reactContext?.applicationContext as? Application ?: return@OnCreate

      // No image service is registered: see android/build.gradle. A compatible
      // ILynxImageService must be deliberately chosen before image support is
      // enabled.

      LynxServiceCenter.inst().registerService(LynxHttpService)
      LynxServiceCenter.inst().registerService(LynxLogService)

      LynxEnv.inst().init(application, null, null, null)
    }

    // A01 (#15): module-scoped, matching iOS `ExpoLynxModule.swift`. Declared
    // inside the `View {}` block below it would be built as a view-manager
    // function (dispatched through a view ref), not a module function, so
    // `nativeModule.checkForUpdate(...)` in `src/ExpoLynxModule.ts` would be
    // `undefined` at runtime. `reload` stays view-scoped: its lambda needs a
    // specific mounted `ExpoLynxView`; this one needs only a feature name.
    AsyncFunction("checkForUpdate") { feature: String, promise: Promise ->
      val application = appContext.reactContext?.applicationContext
      if (application == null) {
        promise.reject("ERR_LYNX_DELIVERY", "Managed Lynx delivery is unavailable.", null)
        return@AsyncFunction
      }
      ManagedDeliveryCoordinator.checkForUpdate(
        application,
        feature,
        onResult = { promise.resolve(it.modulePayload()) },
        onError = { promise.reject(it.code, it.message, it) },
      )
    }

    // `prewarmRuntime` is intentionally NOT registered on Android (A02, #15). A
    // genuine equivalent means building a background Lynx runtime/shell, which
    // is coupled to Android's threading and sizing model — the parity spec's
    // explicit non-goal (docs/android-parity.md, "first-render performance").
    // `src/ExpoLynxModule.ts` capability-checks the function, so the JS call
    // resolves as a no-op rather than rejecting. Revisit under separate
    // Android performance work.

    View(ExpoLynxView::class) {
      Events("onLoadStart", "onLoad", "onError", "onUpdate")

      Prop("url") { view: ExpoLynxView, url: String ->
        view.setSource(url)
      }

      Prop("sourceJSON") { view: ExpoLynxView, sourceJSON: String? ->
        view.setSourceJSON(sourceJSON)
      }

      Prop("initialDataJSON") { view: ExpoLynxView, initialDataJSON: String? ->
        view.setInitialDataJSON(initialDataJSON)
      }

      AsyncFunction("reload") { view: ExpoLynxView ->
        view.reload()
      }

      OnViewDestroys { view: ExpoLynxView ->
        view.destroy()
      }
    }
  }
}
