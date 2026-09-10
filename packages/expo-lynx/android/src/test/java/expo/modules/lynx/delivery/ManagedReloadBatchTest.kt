package expo.modules.lynx.delivery

import java.util.concurrent.CancellationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * B2 (#16) regression tests. Covers the case iOS's 15s watchdog exists for —
 * Lynx firing neither `onLoadSuccess` nor `onReceivedError` — plus batch
 * settlement, the abort-on-first-failure decision, and the
 * cancellation-vs-failure distinction that keeps a superseded reload from
 * poisoning the release the next batch confirms.
 */
class ManagedReloadBatchTest {
  /** A manual scheduler: nothing runs until [fire] is called. */
  private class FakeClock {
    var scheduled: Runnable? = null
      private set
    var scheduledDelayMs: Long? = null
      private set
    var cancelled: Runnable? = null
      private set

    val schedule: (Long, Runnable) -> Unit = { delayMs, task ->
      scheduled = task
      scheduledDelayMs = delayMs
    }
    val cancel: (Runnable) -> Unit = { task -> cancelled = task }

    fun fire() {
      val task = requireNotNull(scheduled) { "nothing scheduled" }
      task.run()
    }
  }

  private class Outcomes {
    val results = mutableListOf<Result<Unit>>()
    val sink: (Result<Unit>) -> Unit = { results.add(it) }
  }

  private fun batch(
    viewCount: Int,
    clock: FakeClock,
    outcomes: Outcomes,
    timeoutMs: Long = 15_000L,
  ) = ManagedReloadBatch(
    viewCount = viewCount,
    timeoutMs = timeoutMs,
    schedule = clock.schedule,
    cancel = clock.cancel,
    onOutcome = outcomes.sink,
  )

  @Test
  fun `watchdog settles the batch when no view ever calls back`() {
    val clock = FakeClock()
    val outcomes = Outcomes()
    val batch = batch(viewCount = 1, clock = clock, outcomes = outcomes)

    batch.start()
    assertEquals("watchdog armed with the iOS-matching deadline", 15_000L, clock.scheduledDelayMs)
    assertTrue("no outcome before the deadline", outcomes.results.isEmpty())

    clock.fire()

    assertEquals(1, outcomes.results.size)
    val error = outcomes.results.single().exceptionOrNull()
    assertTrue("watchdog reports a timeout", error is ManagedReloadBatch.TimeoutException)
  }

  @Test
  fun `success only after every view reports, then the watchdog is cancelled`() {
    val clock = FakeClock()
    val outcomes = Outcomes()
    val batch = batch(viewCount = 2, clock = clock, outcomes = outcomes)
    batch.start()

    batch.complete(Result.success(Unit))
    assertTrue("one of two views is not enough", outcomes.results.isEmpty())
    assertNull("watchdog still armed", clock.cancelled)

    batch.complete(Result.success(Unit))
    assertEquals(1, outcomes.results.size)
    assertTrue(outcomes.results.single().isSuccess)
    assertSame("watchdog cancelled on settle", clock.scheduled, clock.cancelled)
  }

  @Test
  fun `first view failure aborts the whole batch`() {
    val clock = FakeClock()
    val outcomes = Outcomes()
    val batch = batch(viewCount = 3, clock = clock, outcomes = outcomes)
    batch.start()

    val renderError = ManagedDeliveryException("lynx", "ERR_LYNX_CANDIDATE", "render failed")
    batch.complete(Result.failure(renderError))

    assertEquals(1, outcomes.results.size)
    assertSame(renderError, outcomes.results.single().exceptionOrNull())
    assertSame("watchdog cancelled", clock.scheduled, clock.cancelled)
  }

  @Test
  fun `a cancelled completion is reported as cancellation, not a render failure`() {
    val clock = FakeClock()
    val outcomes = Outcomes()
    val batch = batch(viewCount = 1, clock = clock, outcomes = outcomes)
    batch.start()

    batch.complete(Result.failure(CancellationException("superseded")))

    val error = outcomes.results.single().exceptionOrNull()
    assertTrue("still a CancellationException", error is CancellationException)
    assertTrue("but not the watchdog's timeout", error !is ManagedReloadBatch.TimeoutException)
  }

  @Test
  fun `the batch settles exactly once even under watchdog then late completes`() {
    val clock = FakeClock()
    val outcomes = Outcomes()
    val batch = batch(viewCount = 2, clock = clock, outcomes = outcomes)
    batch.start()

    clock.fire()
    batch.complete(Result.success(Unit))
    batch.complete(Result.success(Unit))
    batch.complete(Result.failure(ManagedDeliveryException("lynx", "x", "y")))

    assertEquals("only the watchdog outcome survives", 1, outcomes.results.size)
    assertTrue(outcomes.results.single().exceptionOrNull() is ManagedReloadBatch.TimeoutException)
  }

  @Test
  fun `an empty view set settles success synchronously without arming the watchdog`() {
    val clock = FakeClock()
    val outcomes = Outcomes()
    val batch = batch(viewCount = 0, clock = clock, outcomes = outcomes)

    batch.start()

    assertNull("no watchdog for an empty batch", clock.scheduled)
    assertEquals(1, outcomes.results.size)
    assertTrue(outcomes.results.single().isSuccess)
  }
}
