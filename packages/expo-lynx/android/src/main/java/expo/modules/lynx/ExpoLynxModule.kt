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

      // Image service (Coil or otherwise) is intentionally NOT registered —
      // see android/build.gradle. Demo bundles don't reference images; pages
      // that do will need a CoilLynxImageService.kt implementing
      // ILynxImageService and registered here before LynxEnv.init.

      LynxServiceCenter.inst().registerService(LynxHttpService)
      LynxServiceCenter.inst().registerService(LynxLogService)

      LynxEnv.inst().init(application, null, null, null)
    }

    View(ExpoLynxView::class) {
      Prop("url") { view: ExpoLynxView, url: String ->
        view.loadBundle(url)
      }

      Events("onLoadStart", "onLoad", "onError")
    }
  }
}