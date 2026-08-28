# PR7 — Last-known-good fallback

**Spec:** feature/delivery-bundle-update/specs/client/pr-07-lkg-fallback.md

## Goal

When a candidate fails to render, times out, or dies before readiness confirmation, restore the previous LKG; never boot-loop or blank the screen.

## Files

- `ios/LynxBundleCoordinator.swift` (owns candidate attempt and rollback)
- `ios/LynxChannelState.swift` (persists attempting/LKG/failed IDs)
- `ios/ExpoLynxView.swift` (reports load success/failure)

## Contract

Failure sequence:
1. Write `attemptingReleaseId` before rendering a candidate.
2. `onLoad` before the watchdog timeout confirms it as active/LKG.
3. Error, timeout, or an uncleared attempt on next process launch marks it failed.
4. Restore the previous LKG, or embedded baseline when no remote LKG exists.
5. Never offer the failed immutable release ID again.

## Why

See [Architecture](../../ARCHITECTURE.md).

## Acceptance criteria

- [ ] Push a candidate whose bundle crashes Lynx → app keeps showing v(N-1) with `onLoad` firing for v(N-1) instead of v(N)
- [ ] Kill the process before candidate readiness → next launch restores LKG
- [ ] Worker returns the same failed release → client skips it without download

## Out of scope

- Telemetry normalization (PR8)
- Safe activation gating (PR9)
