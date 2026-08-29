# M04 — React Native prefetch, iOS activation, candidate view, and recovery

**Spec:** `feature/delivery-bundle-update/specs/v2/mobile/m04-prefetch-activation-recovery.md`

## Goal

Expose one understandable React Native prefetch/progress API and connect it to
the complete iOS open/activation lifecycle: immediate local UI, `next-open` by
default, optional separate candidate view, health confirmation, process-death
rollback, and terminal splash callbacks.

## Why these tasks are merged

Prefetch produces `pendingReleaseId`; activation consumes it. Splitting the API
from activation left unclear whether prefetch changed the visible view and who
owned terminal events. One coordinator now owns open, prefetch, install
observation, activation, and recovery, while React Native owns only product UI.

## Depends on

- [M01 — Shared protocol/types](m01-shared-release-protocol.md).
- [M02 — Embedded registry and trust](m02-trust-roots-signature-verification.md).
- [M03 — iOS release installation](m03-ios-archive-installation.md).

## Owned files

- `ExpoLynxModule.ts`, public types/exports, and JS tests
- `ExpoLynxModule.swift`, `ExpoLynxView.swift`
- iOS delivery coordinator and channel state
- activation/watchdog/candidate/state tests
- example controls/evidence only as needed

## Public API

```ts
prefetchLynxBundle(options: {
  feature: string;
  channel?: 'stable' | 'beta';
}): Promise<{
  feature: string;
  channel: string;
  releaseId: string;
  version: string;
  status: 'already-ready' | 'downloaded' | 'pending';
}>;
```

React Native passes only feature/channel. Native configuration resolves the
production endpoint and owns trust, URLs, files, state, and activation.

Progress contains transaction ID, feature/channel/release, phase, normalized
progress, downloaded/total bytes, and optional stable error. It excludes URLs,
tokens, headers, private paths, initial data, and bundle content.

## Coordinator concurrency/threading

- Deduplicate open/prefetch requests for the same resolved release; observers
  receive the same underlying result.
- Listener removal/unmount does not cancel shared required work unexpectedly.
- Network, hashing, ZIP, and file work stay off UI and RN JS threads.
- LynxView mutations and RN event delivery occur on the platform UI thread.
- Rate-limit/coalesce progress and reject stale callbacks by generation +
  feature + release identity.
- Every visible loading state terminates as loaded candidate/current fallback or
  explicit error; never leave “Loading Mini app” indefinitely.

## Open/fallback resolution

Resolve only the exact requested canonical feature:

1. recover unconfirmed attempt and partial transaction;
2. attempt a fully installed pending release when eligible;
3. otherwise use confirmed active release;
4. use previous LKG only for recovery;
5. use that feature's read-only embedded registry entry.

Unknown/missing features fail explicitly. Never load generic `static.lynx` or
another feature. Render usable local content before waiting for a channel check.

## State machine

Per feature/channel state includes last accepted revision, active, previous LKG,
pending, attempting, failed immutable IDs, and ETag. Serialize transitions.

### Prefetch

- Resolve/check/install through M03 without changing the current view or active
  pointer.
- `already-ready` returns quickly without network or hash scan.
- New verified content becomes `pendingReleaseId` for `next-open`.

### `next-open` — default

- Keep current UI during prefetch/install.
- On the next mini-app open, preserve prior LKG and durably write
  `attemptingReleaseId` before rendering the pending candidate.
- Confirm active only after Lynx main-bundle success plus the documented short
  health boundary with no fatal error.
- Load error, timeout, or process death blocks the immutable ID and restores LKG
  or embedded. A fixed release requires a new ID; no boot loop.

### `on-launch` / `force`

- Keep the mounted active view visible while a separate candidate LynxView
  loads.
- Candidate receives identical bounds, safe-area/global props, initial data,
  and resource roots.
- Swap only after health confirmation; otherwise destroy candidate and retain
  active view.
- If measured memory cannot support two views, disable current-open activation
  and defer to `next-open`; never blank/reload in place as a shortcut.
- `force` selects this safe timing at an open boundary only. It never bypasses
  verification, compatibility, failed-ID blocking, health, or rollback and
  cannot destroy an interactive mounted view remotely.

## Event semantics

- Stable `onLoadStart`/`onStart`, `onLoad`, `onError`, and update progress/result
  payloads include source (`embedded`, `cache`, `candidate`) and release ID when
  applicable.
- Splash UI may hide on successful local load even while update revalidation
  continues.
- Offline/update failure while usable local content is loaded is an update
  event, not a blank terminal view.
- Source changes/unmount ignore obsolete callbacks safely.

## Acceptance criteria

- [ ] RN prefetch observes monotonic phases and two callers perform one install.
- [ ] Prefetch never reloads/blanks mounted UI or changes active pointer.
- [ ] First offline open loads the requested embedded baseline quickly.
- [ ] `next-open` installs now, keeps current UI, and attempts on next open.
- [ ] Success promotes candidate and preserves previous rollback LKG.
- [ ] Error/timeout/process kill restores LKG/embedded and blocks failed ID.
- [ ] `on-launch` never hides active content before candidate health success.
- [ ] Safe-area/container layout does not jump during swap.
- [ ] Listener removal, rapid source change, and stale callbacks leak/crash none.
- [ ] Offline/error/splash always reaches a deterministic terminal state.
- [ ] One-view/two-view timing and memory comparison is recorded.

## Required verification

```bash
pnpm run test
pnpm run lint
pnpm run build
```

Also run physical iOS internal Release cases for embedded, cached, duplicate
prefetch, offline, next-open, on-launch, force, load error, timeout, process
kill, rapid source change, and safe-area stability. Attach a short candidate
swap recording and state before/after evidence.

## Out of scope

- OS background fetch and arbitrary production URLs.
- Preserving internal Lynx page state across release replacement.
- Mid-interaction forced replacement.
- Android parity (M05) and cache quota policy (M07).
