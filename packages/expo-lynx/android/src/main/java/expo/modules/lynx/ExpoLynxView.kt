package expo.modules.lynx

import android.content.Context
import android.view.View
import android.view.ViewGroup
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
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

  private var source = ""
  private var initialDataJSON: String? = null
  private var hasLoadedTemplate = false
  private var loadScheduled = false
  private var lastSafeAreaInsets: Insets? = null

  private val onLoadStart by EventDispatcher<Map<String, String>>()
  private val onLoad by EventDispatcher<Map<String, String>>()
  private val onError by EventDispatcher<Map<String, Any?>>()

  init {
    lynxView.layoutParams = ViewGroup.LayoutParams(
      LayoutParams.MATCH_PARENT,
      LayoutParams.MATCH_PARENT
    )
    addView(lynxView)

    // Expo's root view is edge-to-edge on current Android versions. Mirror iOS's
    // safeAreaInsets by exposing the union of system bars and display cutouts to
    // the Lynx page. Do not consume them: React Native still owns its own inset
    // handling above this native view.
    ViewCompat.setOnApplyWindowInsetsListener(this) { _, windowInsets ->
      syncSafeAreaInsets(windowInsets)
      windowInsets
    }

    lynxView.addLynxViewClient(object : LynxViewClient() {
      override fun onLoadSuccess() {
        hasLoadedTemplate = true
        lynxView.visibility = View.VISIBLE
        // Global props are per rendered page. Reapply the current values after
        // each successful load in case the first inset callback ran before Lynx
        // had a template renderer.
        syncSafeAreaInsets(ViewCompat.getRootWindowInsets(this@ExpoLynxView), force = true)
        onLoad.invoke(mapOf("url" to source))
      }

      override fun onReceivedError(error: LynxError) {
        // Hide the previous render so a failed reload cannot leave stale UI on
        // screen. Android's public LynxView API has no wipe-but-stay-alive call.
        lynxView.visibility = View.GONE

        // Mirror iOS's required payload shape while retaining SDK details useful
        // to callers that want to diagnose a failed bundle load.
        onError.invoke(
          mapOf(
            "url" to source,
            "code" to error.errorCode.toString(),
            "message" to error.summaryMessage.ifEmpty { error.msg },
            "subCode" to error.subCode,
            "type" to error.type,
            "level" to (error.level ?: ""),
            "fixSuggestion" to error.fixSuggestion,
            "rootCause" to error.rootCause,
            "json" to error.msg,
          )
        )
      }
    })
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    syncSafeAreaInsets(ViewCompat.getRootWindowInsets(this))
  }

  fun setSource(value: String) {
    val nextSource = value.trim()
    if (nextSource == source) return

    source = nextSource
    scheduleLoad()
  }

  fun setInitialDataJSON(value: String?) {
    if (value == initialDataJSON) return

    initialDataJSON = value
    if (hasLoadedTemplate && !value.isNullOrEmpty()) {
      lynxView.updateData(value)
    }
    scheduleLoad()
  }

  fun reload() {
    scheduleLoad()
  }

  fun destroy() {
    lynxView.destroy()
  }

  private fun scheduleLoad() {
    if (loadScheduled) return

    // Props may arrive in either order during one React commit. Posting the
    // render to the UI queue makes the load see the final url + initialData
    // pair, matching iOS's OnViewDidUpdateProps batching behavior.
    loadScheduled = true
    post {
      loadScheduled = false
      loadSource()
    }
  }

  private fun loadSource() {
    if (source.isEmpty()) return

    hasLoadedTemplate = false
    lynxView.visibility = View.VISIBLE
    onLoadStart.invoke(mapOf("url" to source))
    lynxView.renderTemplateUrl(source, initialDataJSON ?: "")
  }

  private fun syncSafeAreaInsets(windowInsets: WindowInsetsCompat?, force: Boolean = false) {
    val insets = windowInsets?.getInsets(
      WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
    ) ?: Insets.NONE
    if (!force && insets == lastSafeAreaInsets) return

    lastSafeAreaInsets = insets
    // Lynx global props are host-owned and each update re-renders the entire
    // page. Only update when the Android safe area actually changes.
    lynxView.updateGlobalProps(
      mapOf(
        "safeAreaTop" to insets.top,
        "safeAreaBottom" to insets.bottom,
        "safeAreaLeft" to insets.left,
        "safeAreaRight" to insets.right,
      )
    )
  }
}
