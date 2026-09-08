package com.lynxexample

import android.os.Bundle
import android.view.ViewGroup
import androidx.appcompat.app.AppCompatActivity
import com.lynx.tasm.LynxBooleanOption
import com.lynx.tasm.LynxView
import com.lynx.tasm.LynxViewBuilder
import com.lynx.jsbridge.LynxModule
import com.lynx.tasm.behavior.Behavior
import com.lynx.tasm.behavior.LynxContext
import com.lynx.xelement.XElementBehaviors
import expo.modules.lynx.fastimage.LynxFastImageUI

class MainActivity : AppCompatActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    // 10.0.2.2 is the host loopback from the Android emulator.
    val uri =
      if (BuildConfig.DEBUG) "http://10.0.2.2:3000/main.lynx.bundle?fullscreen=true"
      else "main.lynx.bundle"

    val lynxView = buildLynxView()
    lynxView.layoutParams = ViewGroup.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.MATCH_PARENT,
    )
    setContentView(lynxView)
    lynxView.renderTemplateUrl(uri, "")
  }

  private fun buildLynxView(): LynxView {
    val builder = LynxViewBuilder()
    builder.addBehaviors(XElementBehaviors().create())

    // <x-lynx-fast-image> — Glide-backed image element from expo-lynx-view.
    builder.addBehavior(object : Behavior("x-lynx-fast-image") {
      override fun createUI(context: LynxContext) = LynxFastImageUI(context)
    })

    builder.setTemplateProvider(LynxTemplateProvider(this))
    builder.setEnableGenericResourceFetcher(LynxBooleanOption.TRUE)
    builder.setGenericResourceFetcher(GenericResourceFetcher())

    if (BuildConfig.DEBUG) {
      // rspeedy's HMR client needs a `WebSocket` global, which LynxDevtool's
      // module provides. Referenced reflectively so `main` doesn't depend on
      // the debug-only devtool artifact.
      runCatching {
        @Suppress("UNCHECKED_CAST")
        val moduleClass =
          Class.forName("com.lynx.devtool.module.LynxWebSocketModule") as Class<out LynxModule>
        builder.registerModule("LynxWebSocketModule", moduleClass)
      }
    }

    return builder.build(this)
  }
}
