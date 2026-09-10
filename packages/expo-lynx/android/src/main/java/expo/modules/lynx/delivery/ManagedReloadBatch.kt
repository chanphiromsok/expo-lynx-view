package expo.modules.lynx.delivery

import java.util.concurrent.CancellationException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Coordinates one forced-reload fan-out across the mounted views of a feature.
 *
 * B2 (#16): iOS's `LynxManagedViewRegistry.reloadMountedViews` waits on a
 * `CheckedContinuation` and pairs it with a per-view 15s watchdog
 * (`ExpoLynxView.startWatchdog`) so a release that renders neither
 * `onLoadSuccess` nor `onReceivedError` still settles. The Android coordinator
 * had the fan-out and the `remaining` / `finished` bookkeeping inline in
 * `reloadOrStage` with no deadline: if Lynx fired neither callback the
 * `checkForUpdate` promise hung for the process lifetime.
 *
 * This type owns that bookkeeping plus the watchdog, and is deliberately free
 * of Android imports so the hang and the generation races are unit-testable
 * without a device (`schedule` / `cancel` are injected). It settles exactly
 * once, via [onOutcome]:
 *  - success once every view has reported success,
 *  - failure on the first view failure (batch is atomic — a partial reload
 *    would leave sibling views inconsistent; matches iOS `ReloadCompletion`),
 *  - failure with a [CancellationException] if a view's completion was
 *    cancelled (superseded by a newer forced reload, or the view unmounted) —
 *    [onOutcome] must treat this differently from a render failure and NOT
 *    record it against the release,
 *  - failure with [TimeoutException] if the watchdog fires first.
 */
internal class ManagedReloadBatch(
  private val viewCount: Int,
  private val timeoutMs: Long,
  private val schedule: (delayMs: Long, task: Runnable) -> Unit,
  private val cancel: (task: Runnable) -> Unit,
  private val onOutcome: (Result<Unit>) -> Unit,
) {
  class TimeoutException(message: String) : CancellationException(message)

  private val remaining = AtomicInteger(viewCount)
  private val finished = AtomicBoolean(false)

  private val watchdog = Runnable {
    settle(
      Result.failure(
        TimeoutException(
          "The forced Lynx release did not finish loading within ${timeoutMs / 1000} seconds.",
        ),
      ),
    )
  }

  /** Report one view's result. Safe to call after the batch has settled. */
  val complete: (Result<Unit>) -> Unit = { result ->
    result.fold(
      onSuccess = { if (remaining.decrementAndGet() <= 0) settle(Result.success(Unit)) },
      onFailure = { settle(Result.failure(it)) },
    )
  }

  /** Arm the watchdog. Call before dispatching the per-view force reloads. */
  fun start() {
    if (viewCount <= 0) {
      settle(Result.success(Unit))
      return
    }
    schedule(timeoutMs, watchdog)
  }

  private fun settle(result: Result<Unit>) {
    if (!finished.compareAndSet(false, true)) return
    cancel(watchdog)
    onOutcome(result)
  }
}
