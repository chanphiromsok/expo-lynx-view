package expo.modules.lynx

import android.content.Context
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import java.io.File
import java.net.URI
import java.util.concurrent.CancellationException
import java.util.concurrent.ConcurrentHashMap
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
  private var target: LynxLoadTarget? = null
  private var destroyed = false
  private var deliveryStarted = false
  private var forceReloadCompletion: ((Result<Unit>) -> Unit)? = null

  // B1/A1 (#16), A5 (#17): the load-generation, delivery-epoch, and post{}
  // coalescing counters that decide which asynchronous callback is still
  // current now live in `LynxLoadArbiter` -- a plain-JVM class with no
  // Android imports, so the regressions those counters fixed (`git show
  // 2029ae5`, `git show 40c7d35`) are pinned with unit tests. See its doc
  // comment for the reasoning behind each counter.
  private val arbiter = LynxLoadArbiter()
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
        // A3 (#16): a Lynx callback queued before `destroy()` can still fire
        // after it -- `LynxView.destroy()` gives no guarantee that in-flight
        // callbacks are dropped. Without this guard a late `onLoadSuccess`
        // would `confirm(...)` against process-wide delivery state and
        // `invoke` an `EventDispatcher` backed by a torn-down view.
        if (destroyed) return
        // B1: a newer load has been scheduled since this render was dispatched.
        // Its own `onLoadSuccess` will run against the arbiter's pinned
        // render; applying this one would confirm the wrong release.
        if (!arbiter.isRenderCurrent) return
        val current = arbiter.currentRenderTarget ?: return
        hasLoadedTemplate = true
        lynxView.visibility = View.VISIBLE
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
            ManagedDeploymentState.get(context).confirm(current.feature, runtime, releaseId)
          }
        }
        onLoad.invoke(loadPayload(current))
        if (current.managedRuntime != null && !deliveryStarted) {
          deliveryStarted = true
          post { startManagedDelivery(current.feature) }
        }
      }

      override fun onReceivedError(error: LynxError) {
        // A3 (#16): same reasoning as `onLoadSuccess` -- a Lynx callback
        // queued before `destroy()` can still fire after it.
        if (destroyed) return
        // B1: same guard as `onLoadSuccess`. Without it a superseded load's
        // failure would call `fail(...)` on the release the newest load points
        // at and kick off a redundant fallback.
        if (!arbiter.isRenderCurrent) return

        val current = arbiter.currentRenderTarget

        // B6 (#17): Lynx buckets errors by behavior code — `LynxError.getErrorCode()`
        // returns `1xx` for AppBundle failures (load / reload / verify:
        // `LynxErrorBehavior.EB_APP_BUNDLE_*` = 102/105/107) that genuinely blank
        // the page, and `3xx` for resource failures (image, font, external
        // resource, resource module) that Lynx renders around. iOS gates its
        // fatal path on exactly this (`isMainBundleError`: `errorCode / 100 == 1`).
        // Android was treating every `onReceivedError` as fatal, so a missing
        // `ILynxImageService` (`sub_code` 32102, behavior 321) hid the view and
        // marked a healthy managed release as failed — permanently, via
        // `failedReleaseIds`. Only an AppBundle error is fatal now.
        val fatal = error.errorCode / 100 == 1

        if (fatal) {
          // Hide the previous render so a failed reload cannot leave stale UI on
          // screen. Android's public LynxView API has no wipe-but-stay-alive call.
          lynxView.visibility = View.GONE

          current?.candidateReleaseId?.let { releaseId ->
            current.managedRuntime?.let { runtime ->
              ManagedDeploymentState.get(context).fail(current.feature, runtime, releaseId)
              forceReloadCompletion?.let { completion ->
                forceReloadCompletion = null
                completion(Result.failure(ManagedDeliveryException("lynx", "ERR_LYNX_CANDIDATE", "The downloaded Lynx release failed to render.")))
              }
              loadBestLocalManagedSource(current.feature, runtime)
              return
            }
          }
        }

        // B6 (#17): emit the stable `ERR_LYNX_RENDER` identifier and carry the
        // Lynx SDK's numeric `errorCode` in `nativeCode`, so JS can switch on
        // `code` without branching on `Platform.OS`. Non-fatal resource errors
        // are still surfaced here — the caller decides what to do — but the view
        // keeps whatever Lynx rendered.
        emitError(
          current?.feature ?: "",
          current?.source ?: "development",
          "lynx",
          "ERR_LYNX_RENDER",
          error.summaryMessage.ifEmpty { error.msg },
          source,
          error.errorCode.toString(),
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
      // B6 (#17): match iOS `ERR_LYNX_SOURCE_INVALID`.
      emitError("", "", "manifest", "ERR_LYNX_SOURCE_INVALID", "The Lynx source is invalid.", "")
      return
    }
    when (sourceObject.optString("kind")) {
      "development" -> setSource(sourceObject.optString("url"))
      "embedded" -> loadEmbedded(sourceObject.optString("feature"))
      "managed" -> loadManaged(sourceObject.optString("feature"))
      else -> emitError("", "", "manifest", "ERR_LYNX_SOURCE_INVALID", "The Lynx source is invalid.", "")
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

  private fun scheduleLoad(deliveryOwned: Boolean = false) {
    // B1: every scheduled load supersedes whatever was in flight. Bumping the
    // arbiter's load generation before the coalescing early-return means a
    // stale SDK callback that lands between now and `loadSource()` already
    // sees itself as superseded.
    //
    // A1/A2 (#16): `deliveryOwned` is true only for the `scheduleLoad` calls
    // reached via `loadManagedRelease` (both the plain delivery-selection path
    // and the forced-reload path) and via `loadBestLocalManagedSource`'s
    // embedded-fallback branch -- i.e. the delivery machinery choosing what to
    // render, not the user changing props. For those, the load generation is
    // still bumped (the Lynx SDK callback guard must still see it), but the
    // delivery epoch is left alone and any `forceReloadCompletion` is left
    // for its own caller to resolve. A user-initiated load (`setSource`,
    // `setSourceJSON`, `setInitialDataJSON`, `reload()`) supersedes any
    // forced reload in flight: bump the delivery epoch so `startManagedDelivery`
    // still sees its own result, and resolve `forceReloadCompletion` the way
    // iOS's `scheduleLoad` does -- otherwise the completion is only ever
    // settled by the 15s watchdog, which wrongly fails a release that would
    // have rendered fine.
    arbiter.beginLoad(deliveryOwned)
    if (!deliveryOwned) {
      forceReloadCompletion?.let { completion ->
        forceReloadCompletion = null
        completion(Result.failure(CancellationException()))
      }
    }

    if (!arbiter.coalesce()) return

    // Props may arrive in either order during one React commit. Posting the
    // render to the UI queue makes the load see the final url + initialData
    // pair, matching iOS's OnViewDidUpdateProps batching behavior.
    post {
      arbiter.beginScheduledRender()
      loadSource()
    }
  }

  private fun loadSource() {
    val current = target ?: return
    if (current.url.isEmpty()) return

    // B6 (#17): match iOS's `resolveLocalURL` guard — a missing local bundle
    // reports `stage: resource, code: ERR_LYNX_SOURCE_NOT_FOUND` instead of
    // surfacing later as an opaque Lynx render error. Scoped to non-candidate
    // loads: a missing *candidate* bundle must still flow through
    // `onReceivedError` so the release is failed and the view falls back.
    if (current.candidateReleaseId == null && !localBundleExists(current)) {
      emitError(current.feature, current.source, "resource", "ERR_LYNX_SOURCE_NOT_FOUND", "Could not find the Lynx bundle at the resolved local path.", current.url)
      return
    }

    hasLoadedTemplate = false
    deliveryStarted = false
    loadStartedAt = SystemClock.elapsedRealtime()
    // B1: this is the load Lynx will actually run. Pin it so `onLoadSuccess` /
    // `onReceivedError` reconcile against the right target and generation.
    arbiter.pinRender(current)
    lynxView.visibility = View.VISIBLE
    when {
      current.url.startsWith("file:") -> templateProvider.setLocalResourceRoot(File(URI(current.url)).parentFile)
      current.assetRoot != null -> templateProvider.setAssetResourceRoot(current.assetRoot)
      else -> templateProvider.setLocalResourceRoot(null)
    }
    onLoadStart.invoke(loadPayload(current))
    lynxView.renderTemplateUrl(current.url, initialDataJSON ?: "")
  }

  private fun loadEmbedded(feature: String) {
    if (!feature.matches(Regex("[a-z][a-z0-9-]{0,63}"))) {
      // B6 (#17): match iOS `ERR_LYNX_EMBEDDED_FEATURE` (distinct from the
      // managed-source code below).
      emitError(feature, "embedded", "manifest", "ERR_LYNX_EMBEDDED_FEATURE", "An embedded Lynx source requires a feature name.", "")
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
    // A5 (#17): `loadManaged` is reached only from `setSourceJSON`, so it is
    // unambiguously user-initiated -- but it delegates to
    // `loadBestLocalManagedSource`, which always calls `scheduleLoad(deliveryOwned
    // = true)` because it also serves a delivery-internal caller
    // (`onReceivedError`'s local-fallback branch). A flag at that call site can't
    // tell the two origins apart, so the bump belongs here, one level up, where
    // the origin is still known. Without it, a delivery check left in flight from
    // the previous load survives a same-feature `setSourceJSON` re-set (it still
    // matches `managedFeature` and the un-bumped delivery epoch) and emits a
    // stale `onUpdate` for a release the new load never picked. See
    // `LynxLoadArbiter.markUserInitiatedDelivery`.
    arbiter.markUserInitiatedDelivery()
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
    val state = ManagedDeploymentState.get(context).recover(feature, runtime)
    val store = ManagedBundleStore(context)
    val pending = state.pendingReleaseId?.let { store.launchInstalledRelease(feature, it, runtime) }
    val active = state.activeReleaseId?.let { store.launchInstalledRelease(feature, it, runtime) }
    val release = pending ?: active
    if (release != null) {
      if (pending != null) ManagedDeploymentState.get(context).beginAttempt(feature, runtime, release.releaseId)
      loadManagedRelease(release, runtime, pending != null)
    } else {
      target = LynxLoadTarget("expo-lynx-embedded/$feature/main.lynx.bundle", feature, "embedded", "embedded", runtime, assetRoot = "expo-lynx-embedded/$feature")
      source = target!!.url
      LynxIFRLogger.log(context, "source_selection_ms", elapsedSinceSelection(), target!!)
      // A1/A2 (#16): delivery-internal -- no local release to try, falling
      // back to the embedded bundle. See `scheduleLoad`.
      scheduleLoad(deliveryOwned = true)
    }
  }

  private fun loadManagedRelease(release: ManagedRelease, runtime: String, candidate: Boolean) {
    target = LynxLoadTarget(release.bundle.toURI().toString(), release.feature, release.version, "cache", runtime, if (candidate) release.releaseId else null)
    source = target!!.url
    LynxIFRLogger.log(context, "source_selection_ms", elapsedSinceSelection(), target!!)
    // A1/A2 (#16): delivery-internal for both callers -- the plain
    // delivery-selection path (`loadBestLocalManagedSource`) and the forced
    // reload path (`forceReloadManagedRelease`). The latter is why this must
    // propagate `deliveryOwned = true`: `forceReloadManagedRelease` installs
    // `forceReloadCompletion` immediately before calling in here, and a
    // `deliveryOwned = false` bump would cancel the very completion it just
    // set. See `scheduleLoad`.
    scheduleLoad(deliveryOwned = true)
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
    // A1 (#16): capture the arbiter's delivery epoch, not its load
    // generation -- a *user* reload or source change while the delivery
    // request is in flight should still drop the stale result, but the
    // delivery's own forced reload also routes through `scheduleLoad` and
    // must not invalidate its own check. The delivery epoch only advances
    // for the former. See `LynxLoadArbiter.beginLoad`.
    val epoch = arbiter.captureDeliveryEpoch()
    val start = SystemClock.elapsedRealtime()
    onUpdate.invoke(mapOf("feature" to feature, "phase" to "checking"))
    ManagedDeliveryCoordinator.checkForUpdate(
      context,
      feature,
      onResult = { result -> if (!destroyed && managedFeature == feature && arbiter.isDeliveryEpochCurrent(epoch)) {
        LynxIFRLogger.logDelivery(context, SystemClock.elapsedRealtime() - start, feature)
        onUpdate.invoke(result.payload())
      } },
      onError = { error -> if (!destroyed && managedFeature == feature && arbiter.isDeliveryEpochCurrent(epoch)) emitDeliveryError(feature, error) },
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

  /**
   * B6 (#17): true unless this is a local source (`cache` file URL or an
   * `embedded` asset) whose bundle is demonstrably absent. Remote and
   * development URLs always pass — Lynx owns their transport failures.
   */
  private fun localBundleExists(target: LynxLoadTarget): Boolean = when {
    target.url.startsWith("file:") ->
      runCatching { File(URI(target.url)).isFile }.getOrDefault(false)
    target.assetRoot != null ->
      runCatching {
        val slash = target.url.lastIndexOf('/')
        val dir = if (slash > 0) target.url.substring(0, slash) else ""
        val name = target.url.substring(slash + 1)
        assetNamesIn(dir).contains(name)
      }.getOrDefault(false)
    else -> true
  }

  // A6 (#17): `AssetManager.list(dir)` is a linear scan of the whole asset
  // table -- measurably slow, and `loadSource()` calls `localBundleExists` on
  // the main thread ahead of every render, including the first. Assets are
  // baked into the APK at build time and cannot change within a process, so a
  // directory's listing is safe to cache forever once it succeeds -- shared
  // across every `ExpoLynxView` instance, since they all read the same APK.
  // A listing that throws is deliberately NOT cached: `AssetManager.list` can
  // fail for reasons other than "the directory doesn't exist" (a transient
  // I/O error, a torn-down `AssetManager`), and caching that as an
  // authoritative empty set would turn a one-off failure into a permanent
  // false for the rest of the process -- so the exception is left to
  // propagate to the `runCatching` in `localBundleExists`, which already
  // treats it as "not found" for this call only. `computeIfAbsent` on
  // `ConcurrentHashMap` gives atomic guarded access without caching on
  // exception.
  private fun assetNamesIn(dir: String): Set<String> =
    assetListingCache.computeIfAbsent(dir) { context.assets.list(dir)?.toSet() ?: emptySet() }

  private fun elapsedSinceSelection() = SystemClock.elapsedRealtime() - sourceSelectionStartedAt
  private fun elapsedSinceLoad() = SystemClock.elapsedRealtime() - loadStartedAt

  private fun emitError(
    feature: String,
    source: String,
    stage: String,
    code: String,
    message: String,
    url: String,
    nativeCode: String? = null,
  ) {
    onError.invoke(buildMap {
      put("url", url)
      put("feature", feature)
      put("source", source)
      put("stage", stage)
      put("code", code)
      put("message", message)
      nativeCode?.let { put("nativeCode", it) }
    })
  }

  private companion object {
    // A6 (#17): backs `assetNamesIn` -- see that function's comment.
    private val assetListingCache = ConcurrentHashMap<String, Set<String>>()
  }
}
