package expo.modules.lynx

import android.content.Context
import android.view.View
import android.view.ViewGroup
import com.lynx.tasm.LynxError
import com.lynx.tasm.LynxView
import com.lynx.tasm.LynxViewBuilder
import com.lynx.tasm.LynxViewClient
import com.lynx.xelement.XElementBehaviors
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

@Suppress("ViewConstructor")
class ExpoLynxView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  // Override `shouldUseAndroidLayout` so Android's layout system measures
  // the LynxView child even when React Native's Yoga-driven requestLayout
  // doesn't propagate to it. Without this, the child ends up with
  // MATCH_PARENT × MATCH_PARENT LayoutParams but never gets measured, and
  // the screen stays blank even though Lynx itself is running.
  override val shouldUseAndroidLayout: Boolean = true

  private val lynxView: LynxView = LynxViewBuilder()
    .setTemplateProvider(LynxTemplateProvider(context))
    .addBehaviors(XElementBehaviors().create())
    .build(context)

  private val onLoadStart by EventDispatcher<Unit>()
  private val onLoad by EventDispatcher<Unit>()
  private val onError by EventDispatcher<MutableMap<String, Any?>>()

  init {
    lynxView.layoutParams = ViewGroup.LayoutParams(
      LayoutParams.MATCH_PARENT,
      LayoutParams.MATCH_PARENT
    )
    addView(lynxView)

    lynxView.addLynxViewClient(object : LynxViewClient() {
      override fun onLoadSuccess() {
        lynxView.visibility = View.VISIBLE
        onLoadStart.invoke(Unit)
        onLoad.invoke(Unit)
      }

      override fun onReceivedError(error: LynxError) {
        // ponytail: hide the previous render so a failed reload doesn't
        // show the stale bundle. Android has no public wipe-but-stay-alive
        // API for LynxView either; visibility is the only safe option.
        lynxView.visibility = View.GONE

        // Mirrors the iOS payload shape so the JS-side onError handler
        // doesn't need a platform branch.
        val payload: MutableMap<String, Any?> = mutableMapOf(
          "url" to "",
          "code" to error.errorCode,
          "message" to (error.summaryMessage.ifEmpty { error.msg }),
          "subCode" to error.subCode,
          "type" to error.type,
          "level" to (error.level ?: ""),
          "fixSuggestion" to error.fixSuggestion,
          "rootCause" to error.rootCause,
          "json" to error.msg,
        )
        onError.invoke(payload)
      }
    })
  }

  fun loadBundle(src: String) {
    lynxView.visibility = View.VISIBLE
    lynxView.renderTemplateUrl(src, "")
  }
}