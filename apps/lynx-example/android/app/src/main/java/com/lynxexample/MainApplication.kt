package com.lynxexample

import android.app.Application
import com.lynx.service.http.LynxHttpService
import com.lynx.service.log.LynxLogService
import com.lynx.tasm.LynxEnv
import com.lynx.tasm.service.LynxServiceCenter

class MainApplication : Application() {
  override fun onCreate() {
    super.onCreate()

    // No image service / Fresco: <x-lynx-fast-image> renders through Glide.
    LynxServiceCenter.inst().registerService(LynxHttpService)
    LynxServiceCenter.inst().registerService(LynxLogService)

    LynxEnv.inst().init(this, null, null, null)

    if (BuildConfig.DEBUG) {
      LynxEnv.inst().enableLynxDebug(true)
      LynxEnv.inst().enableDevtool(true)
      LynxEnv.inst().enableLogBox(true)
      LynxEnv.inst().setEnableDevtoolDebug(true)
    }
  }
}
