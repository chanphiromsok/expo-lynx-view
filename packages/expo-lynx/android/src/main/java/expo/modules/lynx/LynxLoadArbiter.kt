package expo.modules.lynx

/**
 * Pure counter machine that decides which asynchronous Lynx callback or
 * delivery result is still current. Extracted from `ExpoLynxView` -- the
 * counters here have produced two separate rounds of real bugs (`git show
 * 2029ae5`, `git show 40c7d35`) and were previously the one area of the
 * module with no test coverage, because `ExpoLynxView` extends a UI class and
 * needs a device. This class has no Android imports so it runs as a plain
 * JVM test, matching `ManagedReloadBatch` in `delivery/`.
 *
 * This holds no view state and calls nothing -- `ExpoLynxView` keeps the
 * `post {}` scheduling, `forceReloadCompletion` cancellation, event emission,
 * and all Lynx SDK calls; it only asks this class what to do.
 */
internal class LynxLoadArbiter {
  // B1 (#16): iOS threads a `loadGeneration` (F1) through every async
  // continuation so a superseded load's callback is dropped rather than
  // applied to its successor. `ExpoLynxView.target` is "the latest desired
  // load"; it is reassigned the instant a new load is scheduled. A stale
  // `onLoadSuccess` that reads it at completion time would therefore confirm
  // whatever the newest load points at, on the strength of an older render.
  // `loadGeneration` increments on every scheduled load (`beginLoad`);
  // `renderingGeneration` / `renderingTarget` snapshot the load actually
  // handed to Lynx (`pinRender`), and `isRenderCurrent` is what the SDK
  // callbacks reconcile against before touching delivery state.
  private var loadGeneration = 0
  private var renderingGeneration = -1
  private var renderingTarget: LynxLoadTarget? = null

  // A1 (#16): `startManagedDelivery`'s callbacks used to guard on
  // `loadGeneration`, but the delivery's own forced reload
  // (`forceReloadManagedRelease` -> `loadManagedRelease` -> `scheduleLoad`)
  // advances that same counter on every successful update, so the guard
  // silently dropped the one payload that carries `revision`. `deliveryEpoch`
  // is a second, coarser counter that only user-initiated loads (`setSource`,
  // `setSourceJSON`, `setInitialDataJSON`, `reload()`) advance -- see
  // `beginLoad` and `markUserInitiatedDelivery`. Delivery-internal loads
  // leave it untouched, so a forced reload's own result still matches.
  private var deliveryEpoch = 0

  // C3: `ExpoLynxView.scheduleLoad`'s `post {}` coalescing. This flag means
  // "a render is already queued for this UI-thread tick" -- checked and set
  // by `coalesce`, cleared by `beginScheduledRender` right before the
  // coalesced work runs. Matches iOS's `OnViewDidUpdateProps` batching so
  // props arriving in either order during one React commit still see the
  // final url + initialData pair.
  private var loadScheduled = false

  /**
   * Bump the counters for a newly scheduled load. `loadGeneration` is bumped
   * unconditionally -- B1's SDK-callback guard must see every load, including
   * delivery-internal ones, so a stale callback is still rejected across a
   * forced reload. `deliveryEpoch` is bumped only for a user-initiated load
   * (`deliveryOwned == false`): a delivery-internal load (the delivery
   * machinery choosing what to render, not the user changing props) must NOT
   * invalidate a delivery check it may itself have started -- that was the A1
   * bug (`git show 2029ae5`), where the generation guard ate the result of
   * the reload it started.
   */
  fun beginLoad(deliveryOwned: Boolean) {
    loadGeneration += 1
    if (!deliveryOwned) {
      deliveryEpoch += 1
    }
  }

  // A5 (#17): `loadManaged` is reached only from `setSourceJSON`, so it is
  // unambiguously user-initiated -- but it delegates to
  // `loadBestLocalManagedSource`, which always calls `beginLoad(deliveryOwned
  // = true)` because it also serves a delivery-internal caller
  // (`onReceivedError`'s local-fallback branch). A flag at that call site
  // can't tell the two origins apart, so the bump belongs one level up, where
  // the origin is still known. Without it, a delivery check left in flight
  // from the previous load survives a same-feature `setSourceJSON` re-set (it
  // still matches `managedFeature` and the un-bumped `deliveryEpoch`) and
  // emits a stale `onUpdate` for a release the new load never picked (`git
  // show 40c7d35`).
  fun markUserInitiatedDelivery() {
    deliveryEpoch += 1
  }

  /**
   * The `post {}` coalescing check. Returns `true` the first time it is
   * called since the last [beginScheduledRender] -- the caller must actually
   * enqueue the render; returns `false` if a render is already pending, in
   * which case the caller must do nothing further.
   */
  fun coalesce(): Boolean {
    if (loadScheduled) return false
    loadScheduled = true
    return true
  }

  /**
   * Call right before running the coalesced render (i.e. inside `post {}`,
   * before `loadSource()`), so the next `scheduleLoad` queues a fresh one.
   */
  fun beginScheduledRender() {
    loadScheduled = false
  }

  /**
   * B1: pin the load Lynx is actually about to run, so the SDK callbacks
   * reconcile against the right target instead of whatever the view's
   * `target` has been reassigned to by the time they fire.
   */
  fun pinRender(target: LynxLoadTarget) {
    renderingTarget = target
    renderingGeneration = loadGeneration
  }

  /** B1: false once a newer load has been scheduled since the pinned [pinRender]. */
  val isRenderCurrent: Boolean
    get() = renderingGeneration == loadGeneration

  /** The target pinned by the most recent [pinRender]. */
  val currentRenderTarget: LynxLoadTarget?
    get() = renderingTarget

  /** A1: capture the epoch a delivery check must stay valid for. */
  fun captureDeliveryEpoch(): Int = deliveryEpoch

  /** A1/A5: whether a captured epoch is still the current one. */
  fun isDeliveryEpochCurrent(epoch: Int): Boolean = epoch == deliveryEpoch
}
