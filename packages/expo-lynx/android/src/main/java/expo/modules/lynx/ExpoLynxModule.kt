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
      Events("onLoadStart", "onLoad", "onError")

      Prop("url") { view: ExpoLynxView, url: String ->
        view.setSource(url)
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
