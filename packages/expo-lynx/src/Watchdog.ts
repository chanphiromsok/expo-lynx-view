// PR7 — Watchdog + notifyAppReady state machine
//
// Spec: feature/delivery-bundle-update/specs/client/pr-07-lkg-fallback.md
//
// The native watchdog (LynxCrashWatchdog) lives in iOS/Android. This
// file holds the state machine that decides what `notifyAppReady()`
// returns on each launch.

export type NotifyAppReadyResult =
  { status: 'STABLE' } | { status: 'RECOVERED'; crashedBundleId: string };

export type PendingActivation = {
  manifestId: string;
  feature: string;
  appliedAt: string; // ISO-8601
};

/**
 * Compute the result of notifyAppReady().
 *
 * Pure function: given the previous session's pending activation
 * (if any) and whether the current launch is reaching notifyAppReady
 * for the first time, return what status the caller should emit.
 *
 * Rules (mirrors hot-updater's native pattern):
 * - If pending was set and this is the first notifyAppReady on this
 *   launch → STABLE (the new bundle is running fine).
 * - If pending was set but app crashed before notifyAppReady could
 *   run → RECOVERED(crashedBundleId). Caller must clear pending and
 *   add the crashed bundle to crashHistory.
 * - If no pending was set → STABLE.
 */
export function computeNotifyAppReady(
  pending: PendingActivation | null,
  thisLaunchReachedNotify: boolean
): NotifyAppReadyResult {
  if (pending === null) return { status: 'STABLE' };
  if (!thisLaunchReachedNotify) {
    return { status: 'RECOVERED', crashedBundleId: pending.manifestId };
  }
  return { status: 'STABLE' };
}

/**
 * Decide whether the watchdog should fire on a render timeout.
 * Pure: takes a timeout ms and a candidate start ms, returns true
 * if the watchdog should treat the lack of onLoad as a crash.
 */
export function isWatchdogTimeout(startMs: number, nowMs: number, timeoutMs: number): boolean {
  return nowMs - startMs >= timeoutMs;
}
