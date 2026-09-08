package expo.modules.lynx

import android.app.Application
import android.os.Build
import androidx.annotation.RequiresApi
import com.lynx.service.http.LynxHttpService
import com.lynx.service.log.LynxLogService
import com.lynx.tasm.LynxEnv
import com.lynx.tasm.service.LynxServiceCenter
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import expo.modules.lynx.delivery.ManagedDeliveryCoordinator

class ExpoLynxModule : Module() {
  @RequiresApi(Build.VERSION_CODES.P)
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

      OnViewDestroys { view: ExpoLynxView ->
        view.destroy()
      }
    }
  }
}
