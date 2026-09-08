package expo.modules.lynx

import android.content.Context
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import java.io.File
import java.net.URI
import java.util.concurrent.CancellationException
import com.lynx.tasm.LynxError
import com.lynx.tasm.LynxView
import com.lynx.tasm.LynxViewBuilder
import com.lynx.tasm.LynxViewClient
import com.lynx.tasm.behavior.Behavior
import com.lynx.tasm.behavior.LynxContext
import com.lynx.tasm.behavior.ui.LynxUI
import com.lynx.xelement.XElementBehaviors
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import expo.modules.lynx.delivery.ManagedDeliveryConfig
import expo.modules.lynx.delivery.ManagedDeliveryCoordinator
import expo.modules.lynx.delivery.ManagedDeliveryException
import expo.modules.lynx.delivery.ManagedDeliveryRegistry
import expo.modules.lynx.delivery.ManagedDeploymentState
import expo.modules.lynx.delivery.ManagedBundleStore
import expo.modules.lynx.delivery.ManagedRelease
import expo.modules.lynx.fastimage.LynxFastImageUI
import org.json.JSONObject

internal data class LynxLoadTarget(
  val url: String,
  val feature: String,
  val version: String,
  val source: String,
  val managedRuntime: String? = null,
  val candidateReleaseId: String? = null,
  val assetRoot: String? = null,
)

@Suppress("ViewConstructor")
class ExpoLynxView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  // Override `shouldUseAndroidLayout` so Android's layout system measures
  // the LynxView child even when React Native's Yoga-driven requestLayout
  // doesn't propagate to it. Without this, the child ends up with
  // MATCH_PARENT × MATCH_PARENT LayoutParams but never gets measured, and
  // the screen stays blank even though Lynx itself is running.
  override val shouldUseAndroidLayout: Boolean = true

  private val templateProvider = LynxTemplateProvider(context)
  private val lynxView: LynxView = LynxViewBuilder()
    .setTemplateProvider(templateProvider)
    .addBehaviors(XElementBehaviors().create())
    .addBehaviors(
      listOf(
        // SDWebImage-parity image element backed by Glide (fastimage/).
        object : Behavior("x-lynx-fast-image") {
          override fun createUI(lynxContext: LynxContext): LynxUI<*> = LynxFastImageUI(lynxContext)
        }
      )
    )
    .build(context)

  private var source = ""
  private var initialDataJSON: String? = null
  private var hasLoadedTemplate = false
  private var loadScheduled = false
  private var target: LynxLoadTarget? = null
  private var destroyed = false
  private var deliveryStarted = false
  private var forceReloadCompletion: ((Result<Unit>) -> Unit)? = null
  private var sourceSelectionStartedAt = SystemClock.elapsedRealtime()
  private var loadStartedAt = sourceSelectionStartedAt

  private val onLoadStart by EventDispatcher<Map<String, Any>>()
  private val onLoad by EventDispatcher<Map<String, Any>>()
  private val onError by EventDispatcher<Map<String, Any?>>()
  private val onUpdate by EventDispatcher<Map<String, Any>>()

  internal val managedFeature: String?
    get() = target?.managedRuntime?.let { target?.feature }

  init {
    lynxView.layoutParams = ViewGroup.LayoutParams(
      LayoutParams.MATCH_PARENT,
      LayoutParams.MATCH_PARENT
    )
    addView(lynxView)

    lynxView.addLynxViewClient(object : LynxViewClient() {
      override fun onLoadSuccess() {
        hasLoadedTemplate = true
        lynxView.visibility = View.VISIBLE
        val current = target ?: return
        LynxIFRLogger.log(context, "load_finished_ms", elapsedSinceLoad(), current)
        // Lynx's Android SDK reports its first successful template load here.
        // It has no separate first-screen callback like iOS.
        LynxIFRLogger.log(context, "first_screen_ms", elapsedSinceLoad(), current)
        forceReloadCompletion?.let { completion ->
          forceReloadCompletion = null
          completion(Result.success(Unit))
          onUpdate.invoke(updatePayload(current.feature, "reloaded", current))
        } ?: current.candidateReleaseId?.let { releaseId ->
          current.managedRuntime?.let { runtime ->
            ManagedDeploymentState(context).confirm(current.feature, runtime, releaseId)
          }
        }
        onLoad.invoke(loadPayload(current))
        if (current.managedRuntime != null && !deliveryStarted) {
          deliveryStarted = true
          post { startManagedDelivery(current.feature) }
        }
      }

      override fun onReceivedError(error: LynxError) {
        // Hide the previous render so a failed reload cannot leave stale UI on
        // screen. Android's public LynxView API has no wipe-but-stay-alive call.
        lynxView.visibility = View.GONE

        // Mirror iOS's required payload shape while retaining SDK details useful
        // to callers that want to diagnose a failed bundle load.
        val current = target
        current?.candidateReleaseId?.let { releaseId ->
          current.managedRuntime?.let { runtime ->
            ManagedDeploymentState(context).fail(current.feature, runtime, releaseId)
            forceReloadCompletion?.let { completion ->
              forceReloadCompletion = null
              completion(Result.failure(ManagedDeliveryException("lynx", "ERR_LYNX_CANDIDATE", "The downloaded Lynx release failed to render.")))
            }
            loadBestLocalManagedSource(current.feature, runtime)
            return
          }
        }
        emitError(
          current?.feature ?: "",
          current?.source ?: "development",
          "lynx",
          error.errorCode.toString(),
          error.summaryMessage.ifEmpty { error.msg },
          source,
        )
      }
    })
  }

  fun setSource(value: String) {
    val nextSource = value.trim()
    if (nextSource == source) return

    ManagedDeliveryRegistry.unregister(this)
    sourceSelectionStartedAt = SystemClock.elapsedRealtime()
    target = LynxLoadTarget(nextSource, "", "", "development")
    source = nextSource
    LynxIFRLogger.log(context, "source_selection_ms", elapsedSinceSelection(), target!!)
    scheduleLoad()
  }

  fun setSourceJSON(value: String?) {
    if (value.isNullOrBlank()) return
    val sourceObject = try { JSONObject(value) } catch (_: Exception) {
      emitError("", "", "manifest", "ERR_LYNX_SOURCE", "The Lynx source is invalid.", "")
      return
    }
    when (sourceObject.optString("kind")) {
      "development" -> setSource(sourceObject.optString("url"))
      "embedded" -> loadEmbedded(sourceObject.optString("feature"))
      "managed" -> loadManaged(sourceObject.optString("feature"))
      else -> emitError("", "", "manifest", "ERR_LYNX_SOURCE", "The Lynx source is invalid.", "")
    }
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
    destroyed = true
    forceReloadCompletion?.invoke(Result.failure(CancellationException()))
    forceReloadCompletion = null
    ManagedDeliveryRegistry.unregister(this)
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
    val current = target ?: return
    if (current.url.isEmpty()) return

    hasLoadedTemplate = false
    deliveryStarted = false
    loadStartedAt = SystemClock.elapsedRealtime()
    lynxView.visibility = View.VISIBLE
    when {
      current.url.startsWith("file://") -> templateProvider.setLocalResourceRoot(File(URI(current.url)).parentFile)
      current.assetRoot != null -> templateProvider.setAssetResourceRoot(current.assetRoot)
      else -> templateProvider.setLocalResourceRoot(null)
    }
    onLoadStart.invoke(loadPayload(current))
    lynxView.renderTemplateUrl(current.url, initialDataJSON ?: "")
  }

  private fun loadEmbedded(feature: String) {
    if (!feature.matches(Regex("[a-z][a-z0-9-]{0,63}"))) {
      emitError(feature, "embedded", "manifest", "ERR_LYNX_MANAGED_FEATURE", "A managed Lynx source requires a feature name.", "")
      return
    }
    ManagedDeliveryRegistry.unregister(this)
    sourceSelectionStartedAt = SystemClock.elapsedRealtime()
    target = LynxLoadTarget("expo-lynx-embedded/$feature/main.lynx.bundle", feature, "embedded", "embedded", assetRoot = "expo-lynx-embedded/$feature")
    source = target!!.url
    LynxIFRLogger.log(context, "source_selection_ms", elapsedSinceSelection(), target!!)
    scheduleLoad()
  }

  private fun loadManaged(feature: String) {
    if (!feature.matches(Regex("[a-z][a-z0-9-]{0,63}"))) {
      emitError(feature, "cache", "manifest", "ERR_LYNX_MANAGED_FEATURE", "A managed Lynx source requires a feature name.", "")
      return
    }
    sourceSelectionStartedAt = SystemClock.elapsedRealtime()
    val config = try { ManagedDeliveryConfig.load(context) } catch (error: ManagedDeliveryException) {
      emitDeliveryError(feature, error)
      loadEmbedded(feature)
      return
    }
    ManagedDeliveryRegistry.register(this)
    loadBestLocalManagedSource(feature, config.runtimeVersion)
  }

  private fun loadBestLocalManagedSource(feature: String, runtime: String) {
    val state = ManagedDeploymentState(context).recover(feature, runtime)
    val store = ManagedBundleStore(context)
    val pending = state.pendingReleaseId?.let { store.launchInstalledRelease(feature, it, runtime) }
    val active = state.activeReleaseId?.let { store.launchInstalledRelease(feature, it, runtime) }
    val release = pending ?: active
    if (release != null) {
      if (pending != null) ManagedDeploymentState(context).beginAttempt(feature, runtime, release.releaseId)
      loadManagedRelease(release, runtime, pending != null)
    } else {
      target = LynxLoadTarget("expo-lynx-embedded/$feature/main.lynx.bundle", feature, "embedded", "embedded", runtime, assetRoot = "expo-lynx-embedded/$feature")
      source = target!!.url
      LynxIFRLogger.log(context, "source_selection_ms", elapsedSinceSelection(), target!!)
      scheduleLoad()
    }
  }

  private fun loadManagedRelease(release: ManagedRelease, runtime: String, candidate: Boolean) {
    target = LynxLoadTarget(release.bundle.toURI().toString(), release.feature, release.version, "cache", runtime, if (candidate) release.releaseId else null)
    source = target!!.url
    LynxIFRLogger.log(context, "source_selection_ms", elapsedSinceSelection(), target!!)
    scheduleLoad()
  }

  internal fun forceReloadManagedRelease(release: ManagedRelease, completion: (Result<Unit>) -> Unit) {
    val current = target
    if (destroyed || current?.managedRuntime == null || current.feature != release.feature) {
      completion(Result.failure(ManagedDeliveryException("lynx", "ERR_LYNX_FORCE_VIEW_MISMATCH", "The mounted Lynx view no longer matches the forced release.")))
      return
    }
    forceReloadCompletion?.invoke(Result.failure(CancellationException()))
    forceReloadCompletion = completion
    onUpdate.invoke(updatePayload(release.feature, "reloading", LynxLoadTarget("", release.feature, release.version, "cache", current.managedRuntime, release.releaseId)))
    loadManagedRelease(release, current.managedRuntime, candidate = true)
  }

  private fun startManagedDelivery(feature: String) {
    if (destroyed || managedFeature != feature) return
    val start = SystemClock.elapsedRealtime()
    onUpdate.invoke(mapOf("feature" to feature, "phase" to "checking"))
    ManagedDeliveryCoordinator.checkForUpdate(
      context,
      feature,
      onResult = { result -> if (!destroyed && managedFeature == feature) {
        LynxIFRLogger.logDelivery(context, SystemClock.elapsedRealtime() - start, feature)
        onUpdate.invoke(result.payload())
      } },
      onError = { error -> if (!destroyed && managedFeature == feature) emitDeliveryError(feature, error) },
    )
  }

  private fun loadPayload(value: LynxLoadTarget): Map<String, Any> = mapOf(
    "url" to value.url,
    "feature" to value.feature,
    "version" to value.version,
    "source" to value.source,
    "durationMs" to elapsedSinceLoad(),
  )

  private fun updatePayload(feature: String, phase: String, value: LynxLoadTarget): Map<String, Any> = buildMap {
    put("feature", feature)
    put("phase", phase)
    value.candidateReleaseId?.let { put("releaseId", it) }
    if (value.version.isNotBlank()) put("version", value.version)
  }

  private fun emitDeliveryError(feature: String, error: ManagedDeliveryException) = emitError(feature, "cache", error.stage, error.code, error.message, "")

  private fun elapsedSinceSelection() = SystemClock.elapsedRealtime() - sourceSelectionStartedAt
  private fun elapsedSinceLoad() = SystemClock.elapsedRealtime() - loadStartedAt

  private fun emitError(feature: String, source: String, stage: String, code: String, message: String, url: String) {
    onError.invoke(mapOf("url" to url, "feature" to feature, "source" to source, "stage" to stage, "code" to code, "message" to message))
  }

}
