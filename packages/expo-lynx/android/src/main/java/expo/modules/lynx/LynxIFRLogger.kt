package expo.modules.lynx

import android.content.Context
import android.content.pm.ApplicationInfo
import android.util.Log

internal object LynxIFRLogger {
  private const val tag = "ExpoLynxIFR"

  fun log(context: Context, name: String, milliseconds: Long, target: LynxLoadTarget) {
    if (!isDebuggable(context)) return
    Log.i(tag, "$name=$milliseconds feature=${target.feature} source=${target.source}")
  }

  fun logDelivery(context: Context, milliseconds: Long, feature: String) {
    if (!isDebuggable(context)) return
    Log.i(tag, "delivery_start_ms=$milliseconds feature=$feature")
  }

  private fun isDebuggable(context: Context) = context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
}
