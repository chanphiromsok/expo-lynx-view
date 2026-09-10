package expo.modules.lynx

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * B1/A1 (#16), A5 (#17) regression tests for the counter machine that decides
 * which asynchronous Lynx callback or delivery result is still current. Two
 * separate rounds of real bugs came out of this logic (`git show 2029ae5`,
 * `git show 40c7d35`); before the extraction into `LynxLoadArbiter` none of
 * it was testable, because `ExpoLynxView` extends a UI class and needs a
 * device.
 */
class LynxLoadArbiterTest {
  private fun target(feature: String) = LynxLoadTarget(
    url = "https://example.test/$feature.lynx.bundle",
    feature = feature,
    version = "1",
    source = "development",
  )

  // Criterion 7 (#16), currently unmet before this extraction: two loads
  // scheduled back to back must result in exactly one confirmed render, and
  // it is the second one. `renderingGeneration` only advances when a render
  // is actually pinned (`pinRender`), while `loadGeneration` advances the
  // instant a load is *scheduled* (`beginLoad`) -- so a second `beginLoad`
  // that lands after the first render was pinned, but before the second
  // render is pinned, must already read as stale for the first render's
  // callback, and only the second render's pin restores currency.
  @Test
  fun `a callback pinned to a superseded render is rejected while one pinned to the current render is accepted`() {
    val arbiter = LynxLoadArbiter()

    // First load: scheduled, coalesced tick runs, render pinned.
    arbiter.beginLoad(deliveryOwned = false)
    assertTrue("first schedule must enqueue the coalesced render", arbiter.coalesce())
    arbiter.beginScheduledRender()
    arbiter.pinRender(target("first"))
    assertTrue("nothing has superseded the first render yet", arbiter.isRenderCurrent)

    // Second load is scheduled before the first render's SDK callback
    // arrives -- `loadGeneration` moves ahead of the still-pinned
    // `renderingGeneration` from the first render.
    arbiter.beginLoad(deliveryOwned = false)
    assertFalse(
      "a callback pinned to the first render must be rejected once a second load is scheduled",
      arbiter.isRenderCurrent,
    )

    // The coalesced post{} tick for the second load now runs.
    assertTrue("loadScheduled was reset after the first tick ran", arbiter.coalesce())
    arbiter.beginScheduledRender()
    arbiter.pinRender(target("second"))
    assertTrue(
      "a callback pinned to the second, current render must be accepted",
      arbiter.isRenderCurrent,
    )
  }

  // Same criterion, from the coalescing side: if the second load is
  // scheduled before the first coalesced tick has even run, only ONE render
  // is ever pinned -- for the latest target.
  @Test
  fun `two loads scheduled before the coalesced tick runs produce exactly one pinned render, for the second target`() {
    val arbiter = LynxLoadArbiter()

    arbiter.beginLoad(deliveryOwned = false)
    assertTrue("first schedule must enqueue the coalesced render", arbiter.coalesce())

    arbiter.beginLoad(deliveryOwned = false)
    assertFalse(
      "the second schedule coalesces into the already-queued render instead of enqueuing another",
      arbiter.coalesce(),
    )

    // Only one post{} tick ever runs, and it renders whatever the latest
    // target is by then.
    arbiter.beginScheduledRender()
    arbiter.pinRender(target("second"))
    assertTrue(arbiter.isRenderCurrent)
  }

  // A1 (#16), `git show 2029ae5`: the delivery generation guard used to eat
  // the result of the very reload it started, because the delivery's own
  // forced reload advanced the same counter `startManagedDelivery` guarded
  // on. A delivery-owned load must leave a previously captured delivery
  // epoch untouched.
  @Test
  fun `a delivery-owned load does not invalidate a captured delivery epoch`() {
    val arbiter = LynxLoadArbiter()

    // A user-initiated managed load kicks off a delivery check, which
    // captures the current epoch.
    arbiter.beginLoad(deliveryOwned = false)
    val epoch = arbiter.captureDeliveryEpoch()

    // The delivery machinery forces a reload of the release it just found --
    // `deliveryOwned = true`, matching `loadManagedRelease`'s call.
    arbiter.beginLoad(deliveryOwned = true)

    assertTrue(
      "a delivery-owned load must not invalidate the epoch its own delivery check captured",
      arbiter.isDeliveryEpochCurrent(epoch),
    )
  }

  // A5 (#17), `git show 40c7d35`: `loadManaged` is unambiguously
  // user-initiated but delegates to `loadBestLocalManagedSource`, which
  // always schedules `deliveryOwned = true` because it also serves a
  // delivery-internal caller. `loadManaged` must bump the epoch itself, one
  // level up, via `markUserInitiatedDelivery`.
  @Test
  fun `a user-initiated managed load invalidates a previously captured delivery epoch`() {
    val arbiter = LynxLoadArbiter()

    arbiter.beginLoad(deliveryOwned = false)
    val epoch = arbiter.captureDeliveryEpoch()

    // JS re-sets the managed source while a delivery check from the
    // previous load is still in flight.
    arbiter.markUserInitiatedDelivery()

    assertFalse(
      "a user-initiated re-set of the managed source must invalidate a previously captured epoch",
      arbiter.isDeliveryEpochCurrent(epoch),
    )
  }

  // Keeps A1's fix from reintroducing the original B1 bug: a delivery-owned
  // load must still be a "new load" as far as the SDK-callback guard is
  // concerned, even though it does not touch the delivery epoch. Otherwise a
  // stale `onLoadSuccess` / `onReceivedError` from before a forced reload
  // would be wrongly accepted after it.
  @Test
  fun `a delivery-owned load still advances the render generation so a stale SDK callback is rejected across it`() {
    val arbiter = LynxLoadArbiter()

    arbiter.beginLoad(deliveryOwned = false)
    arbiter.coalesce()
    arbiter.beginScheduledRender()
    arbiter.pinRender(target("before-forced-reload"))
    assertTrue(arbiter.isRenderCurrent)

    // A forced reload of a managed release -- delivery-owned, but still a
    // new load as far as the render generation is concerned.
    arbiter.beginLoad(deliveryOwned = true)
    assertFalse(
      "a callback pinned to the pre-reload render must be rejected once the forced reload is scheduled",
      arbiter.isRenderCurrent,
    )

    arbiter.coalesce()
    arbiter.beginScheduledRender()
    arbiter.pinRender(target("forced-reload"))
    assertTrue(
      "a callback pinned to the forced reload's own render must be accepted",
      arbiter.isRenderCurrent,
    )
  }

  // A render that has never been superseded must always read as current --
  // the common, non-racy path.
  @Test
  fun `a callback pinned to a render that was never superseded is accepted`() {
    val arbiter = LynxLoadArbiter()

    arbiter.beginLoad(deliveryOwned = false)
    arbiter.coalesce()
    arbiter.beginScheduledRender()
    arbiter.pinRender(target("only"))

    assertTrue(arbiter.isRenderCurrent)
  }
}
