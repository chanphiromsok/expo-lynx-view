package expo.modules.lynx.delivery

import android.content.Context
import android.os.Handler
import android.os.Looper
import expo.modules.lynx.ExpoLynxView
import java.lang.ref.WeakReference
import java.util.concurrent.CancellationException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

internal data class ManagedUpdateResult(
  val feature: String,
  val status: String,
  val releaseId: String? = null,
  val version: String? = null,
  val revision: Int? = null,
) {
  fun payload(phase: String = status): Map<String, Any> = buildMap {
    put("feature", feature)
    put("phase", phase)
    releaseId?.let { put("releaseId", it) }
    version?.let { put("version", it) }
    revision?.let { put("revision", it) }
  }

  fun modulePayload(): Map<String, Any> = buildMap {
    put("feature", feature)
    put("status", status)
    releaseId?.let { put("releaseId", it) }
    version?.let { put("version", it) }
    revision?.let { put("revision", it) }
  }
}

internal object ManagedDeliveryCoordinator {
  // B2 (#16): matches iOS's 15s `ExpoLynxView.startWatchdog` deadline.
  private const val CANDIDATE_TIMEOUT_MS = 15_000L

  private val executor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "ExpoLynxDelivery").apply { isDaemon = true }
  }
  private val main = Handler(Looper.getMainLooper())

  fun checkForUpdate(
    context: Context,
    feature: String,
    onResult: (ManagedUpdateResult) -> Unit,
    onError: (ManagedDeliveryException) -> Unit,
  ) {
    executor.execute {
      try {
        val config = ManagedDeliveryConfig.load(context)
        val stateStore = ManagedDeploymentState.get(context)
        val state = stateStore.recover(feature, config.runtimeVersion)
        when (val update = ManagedBundleStore(context).checkForUpdate(config, feature, state)) {
          is DeploymentUpdate.NotModified -> post(onResult, ManagedUpdateResult(feature, "no-update", revision = state.lastRevision))
          is DeploymentUpdate.Disabled -> {
            stateStore.recordDeployment(feature, config.runtimeVersion, update.eTag, update.revision)
            post(onResult, ManagedUpdateResult(feature, "disabled", revision = update.revision))
          }
          is DeploymentUpdate.Selected -> {
            stateStore.recordDeployment(feature, config.runtimeVersion, update.eTag, update.revision)
            if (!update.force) {
              if (state.activeReleaseId == update.release.releaseId || state.pendingReleaseId == update.release.releaseId) {
                post(onResult, ManagedUpdateResult(feature, "no-update", update.release.releaseId, update.release.version, update.revision))
              } else {
                stateStore.stage(feature, config.runtimeVersion, update.release.releaseId)
                post(onResult, ManagedUpdateResult(feature, "pending", update.release.releaseId, update.release.version, update.revision))
              }
            } else {
              reloadOrStage(config.runtimeVersion, update, stateStore, onResult, onError)
            }
          }
        }
      } catch (error: ManagedDeliveryException) {
        post(onError, error)
      } catch (_: Exception) {
        post(onError, ManagedDeliveryException("download", "ERR_LYNX_DELIVERY", "Managed Lynx delivery could not complete."))
      }
    }
  }

  private fun reloadOrStage(
    runtime: String,
    update: DeploymentUpdate.Selected,
    stateStore: ManagedDeploymentState,
    onResult: (ManagedUpdateResult) -> Unit,
    onError: (ManagedDeliveryException) -> Unit,
  ) {
    val views = ManagedDeliveryRegistry.views(update.release.feature)
    if (views.isEmpty()) {
      stateStore.stage(update.release.feature, runtime, update.release.releaseId)
      post(onResult, ManagedUpdateResult(update.release.feature, "pending", update.release.releaseId, update.release.version, update.revision))
      return
    }
    stateStore.beginAttempt(update.release.feature, runtime, update.release.releaseId)

    val feature = update.release.feature
    val releaseId = update.release.releaseId
    val batch = ManagedReloadBatch(
      viewCount = views.size,
      timeoutMs = CANDIDATE_TIMEOUT_MS,
      schedule = { delayMs, task -> main.postDelayed(task, delayMs) },
      cancel = { task -> main.removeCallbacks(task) },
      onOutcome = { result ->
        result.fold(
          onSuccess = {
            stateStore.confirm(feature, runtime, releaseId)
            post(onResult, ManagedUpdateResult(feature, "reloaded", releaseId, update.release.version, update.revision))
          },
          onFailure = { cause ->
            when (cause) {
              // A4 (#16): branch ORDER is load-bearing -- `ManagedReloadBatch.
              // TimeoutException` extends `CancellationException`, so it must
              // be matched before the `is CancellationException` branch below
              // or every timeout would silently be reported as a supersession
              // instead of a timeout. Do not reorder these two branches.
              is ManagedReloadBatch.TimeoutException -> {
                stateStore.fail(feature, runtime, releaseId)
                post(onError, ManagedDeliveryException("lynx", "ERR_LYNX_CANDIDATE_TIMEOUT", cause.message ?: "The forced Lynx release timed out."))
              }
              // Superseded by a newer forced reload, or the view unmounted
              // (`ExpoLynxView.destroy`). The batch that supersedes this one —
              // or `destroy()` — owns the release outcome; recording a failure
              // here would poison the `attemptingReleaseId` the newer batch is
              // about to confirm (B1). Settle the promise, touch no state.
              is CancellationException ->
                post(onError, ManagedDeliveryException("lynx", "ERR_LYNX_FORCE_SUPERSEDED", "The forced Lynx reload was superseded before it rendered."))
              else -> {
                stateStore.fail(feature, runtime, releaseId)
                val error = cause as? ManagedDeliveryException
                  ?: ManagedDeliveryException("lynx", "ERR_LYNX_FORCE_RELOAD", "The forced Lynx release could not render.")
                post(onError, error)
              }
            }
          },
        )
      },
    )
    batch.start()
    postToMain {
      views.forEach { it.forceReloadManagedRelease(update.release, batch.complete) }
    }
  }

  private fun <T> post(callback: (T) -> Unit, value: T) = postToMain { callback(value) }
  private fun postToMain(block: () -> Unit) = main.post(block)
}

internal object ManagedDeliveryRegistry {
  private val views = mutableListOf<WeakReference<ExpoLynxView>>()

  @Synchronized fun register(view: ExpoLynxView) {
    views.removeAll { it.get() == null }
    views.add(WeakReference(view))
  }

  @Synchronized fun unregister(view: ExpoLynxView) {
    views.removeAll { it.get() == null || it.get() === view }
  }

  @Synchronized fun views(feature: String): List<ExpoLynxView> {
    views.removeAll { it.get() == null }
    return views.mapNotNull { it.get() }.filter { it.managedFeature == feature }
  }
}
