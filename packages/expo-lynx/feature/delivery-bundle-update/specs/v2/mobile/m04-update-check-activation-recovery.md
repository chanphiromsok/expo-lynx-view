# M04 — React Native update check, conditional download, iOS activation, candidate view, and recovery

**Spec:** `feature/delivery-bundle-update/specs/v2/mobile/m04-update-check-activation-recovery.md`

## Goal

Expose one understandable React Native update-check API and connect it to the
complete iOS open/activation lifecycle: immediate local UI, a small throttled
channel check, ZIP download only for a newly advertised release, `next-open` by
default, optional separate candidate view, health confirmation, process-death
rollback, and terminal splash callbacks.

## Why these tasks are merged

The update check produces `pendingReleaseId` only after a channel advertises a
new release and that release installs successfully; activation consumes it.
Splitting the check/download API from activation left unclear whether an update
could change the visible view and who owned terminal events. One coordinator
now owns open, check, conditional download, install observation, activation,
and recovery, while React Native owns only product UI.

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

## Current iOS public API

```ts
type ManagedLynxSource = {
  kind: 'managed';
  feature: LynxFeatureName;
  channel?: 'stable' | 'beta';
  activation?: 'next-open' | 'on-launch';
  /** Signed channel envelope; required by the current iOS implementation. */
  channelUrl?: string;
  /** Debug/local direct signed release envelope only. */
  manifestUrl?: string;
};

type ExpoLynxViewRef = {
  checkForUpdate(): Promise<{
    feature: string;
    channel: 'stable' | 'beta';
    releaseId?: string;
    version?: string;
    status: 'no-update' | 'downloaded' | 'pending';
  }>;
};
```

`checkForUpdate()` is deliberately **view-scoped**. It uses the mounted view's
already-validated managed source and does not accept a URL, public key, or
release ID from the imperative JS call. This matches the iOS implementation and
prevents a second API from overriding the source being rendered.

The application supplies `channelUrl` today because the Worker endpoint is not
yet injected by native build configuration. For production, that value must be
build/config controlled rather than user or remote-page input. `manifestUrl` is
only a local Debug compatibility route and is not the Worker contract.

The result shape is:

```ts
{
  feature: string;
  channel: 'stable' | 'beta';
  releaseId?: string;
  version?: string;
  status: 'no-update' | 'downloaded' | 'pending';
}
```

The native side owns ETag state, signature verification, files, staging, and
activation. A `304 Not Modified`, an unchanged release ID, or an already
ready/pending release returns `no-update` without requesting the ZIP, rehashing
cached content, or extracting anything. `downloaded` is possible when an
install finished but automatic staging was cancelled due to a source change;
`pending` means the installed release was durably staged for the next open.

`onUpdate` is the current event surface. Its phases are `checking`,
`no-update`, `downloaded`, `staged`, and `error`; it carries feature, channel,
release/version/revision when known, and a bounded error code/message. It
intentionally excludes URLs, tokens, headers, private paths, initial data, and
bundle content. Byte-level progress, transaction IDs, and rate-limited transfer
progress are a future enhancement; the current URLSession install path does not
pretend to expose byte progress.

## Worker route contract used by mobile

The client fetches the configured channel URL and follows the **signed relative
`manifestUrl`** inside the verified channel payload. It never constructs a
release URL from a release ID. The Worker and local parity server therefore use
this canonical route shape:

```text
GET /v1/channels/:feature/:channel
GET /v1/releases/:feature/:releaseId/manifest
GET /v1/releases/:feature/:releaseId/release.zip
```

The exact public channel and release envelope bytes are defined by M01. The
channel's `manifestUrl` may be relative to its channel URL, so a local server
and the Worker can have different origins without changing the mobile client.

## Coordinator concurrency/threading

- Deduplicate open/update-check requests for the same feature/channel and
  resolved release; observers receive the same underlying result.
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

### Update check and conditional download

- Read the per-feature/channel check policy (`lastCheckedAt`, ETag, active,
  pending, and failed immutable IDs) before making a request. The policy may
  check once per session, after a configured interval, or after an explicit
  host/API update hint; it must not block the current local open.
- Send `If-None-Match` when an ETag exists. A `304`, an unchanged release ID,
  or a release already marked ready/pending returns `no-update`; it does not
  download a ZIP, repeat archive/file verification, or change the current view
  or active pointer.
- Only a verified channel response that advertises a compatible, non-failed,
  different release can fetch the release envelope and ZIP through M03.
- A newly verified installed release becomes `pendingReleaseId` for
  `next-open`. `downloaded` reports installation completed; `pending` reports
  that the release remains staged for activation.

### `next-open` — default

- Keep current UI during the update check and any conditional download/install.
- On the next mini-app open, preserve prior LKG and durably write
  `attemptingReleaseId` before rendering the pending candidate.
- Confirm active only after Lynx main-bundle success plus the documented short
  health boundary with no fatal error.
- Load error, timeout, or process death blocks the immutable ID and restores LKG
  or embedded. A fixed release requires a new ID; no boot loop.

### `on-launch` / `force`

**Current implementation status:** accepted source settings are safely treated
as `next-open`. The Worker may round-trip `activation` and `force`, but current
iOS does not use either signed field to replace a mounted view.

- Target behavior before enabling current-open activation: keep the mounted
  active view visible while a separate candidate LynxView
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

- [ ] RN update check reports `no-update` for `304`, unchanged, ready, and
      pending releases without a ZIP request or full cached-content hash scan.
- [ ] Two callers checking the same newly advertised release perform one
      download/install transaction and observe monotonic install phases.
- [ ] Update checking/conditional download never reloads or blanks mounted UI
      or changes the active pointer.
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

Also run physical iOS internal Release cases for embedded, cached, channel
`304`, unchanged release, one newly advertised release, duplicate update
checks, offline, next-open, on-launch, force, load error, timeout, process
kill, rapid source change, and safe-area stability. Attach a short candidate
swap recording and state before/after evidence.

## Out of scope

- OS background fetch and arbitrary production URLs.
- Preserving internal Lynx page state across release replacement.
- Mid-interaction forced replacement.
- Android parity (M05) and cache quota policy (M07).
