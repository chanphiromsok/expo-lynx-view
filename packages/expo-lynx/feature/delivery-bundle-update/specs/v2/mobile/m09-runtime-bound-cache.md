# M09 — Runtime-safe IFR launch

**Status:** planned; required before a public mobile release

**Spec:** `feature/delivery-bundle-update/specs/v2/mobile/m09-runtime-bound-cache.md`

## Goal

Select one compatible local Lynx bundle without waiting for delivery work, then
give Lynx an uninterrupted Instant First-Frame Rendering (IFR) path. Never open
a pending or active downloaded bundle unless it was installed for the exact
runtime fingerprint embedded in the current native application.

After an incompatible App Store update, the first feature open uses the new
embedded bundle before any Worker request. Network checks, downloads, cache
maintenance, and forced reloads start only after Lynx completes the initial
first screen.

## Depends on

- [M01 — Mobile signed deployment and ZIP installation](m01-shared-release-protocol.md).
- [C02 — Native runtime fingerprint](../cli/c02-native-runtime-fingerprint.md).

## Owned files

- `packages/expo-lynx/ios/LynxV2Completion.swift`
- `packages/expo-lynx/ios/LynxManagedBundleStore.swift`
- `packages/expo-lynx/ios/LynxManagedDeploymentState.swift`
- `packages/expo-lynx/ios/LynxManagedDeliveryCoordinator.swift`
- `packages/expo-lynx/ios/ExpoLynxView.swift`
- focused Swift parsing/fixture tests

## Installed release contract

The atomic completion marker records the runtime that was authenticated by the
signed deployment:

```swift
struct V2Completion: Codable, Sendable {
  let feature: String
  let releaseID: String
  let version: String
  let runtimeVersion: String
  let archiveSHA256: String
}
```

Installation receives the expected runtime from the verified deployment and
writes it only after ZIP verification and extraction succeed.

Every cached lookup requires `expectedRuntimeVersion`. A completion marker with
a missing, malformed, or different runtime is not an installed candidate for
that host.

Legacy completion markers without `runtimeVersion` fail closed. They are not
marked as bad releases because the same release may be valid for an older
native runtime; the new app simply loads embedded content and may download a
compatible release again.

## Startup resolution

Read the already embedded runtime and one local launch snapshot before resolving
the source:

```text
pending exists and completion.runtimeVersion == host runtime -> attempt pending
active exists and completion.runtimeVersion == host runtime  -> load active
otherwise                                                    -> load embedded
```

The Worker check remains asynchronous and happens after a safe local source is
rendered. A mismatched cache must never be displayed briefly while that check
runs.

State and replay metadata are isolated by runtime and feature:

```text
expo.lynx.managed.v3.<runtimeVersion>.<feature>
```

The runtime must be encoded or hashed into a safe bounded storage-key segment.
Do not interpolate unchecked server input into a key or filesystem path.

This preserves the intended behavior:

- same fingerprint after an app update: the verified remote release remains
  active because it is native-compatible;
- different fingerprint after an app update: old pointers are invisible and
  the new embedded release wins;
- `enabled: false`: still stops new distribution without removing the current
  compatible remote release; and
- offline: loads compatible active/pending content or embedded without waiting.

## Lynx IFR invariant

Lynx IFR requires the selected page bundle and initial data to be locally ready
when `loadTemplate` begins. Asynchronous bundle file I/O or network data before
that call creates an intermediate blank/loading state and forfeits IFR.
See Lynx's [Instant First-Frame Rendering](https://lynxjs.org/next/guide/interaction/ifr)
contract.

For one managed-view generation, the first-render critical path is:

```text
validate the declarative feature
  -> read runtime from native build configuration
  -> synchronously read one bounded UserDefaults launch snapshot
  -> validate only the selected release's small completion marker and entry path
  -> memory-map the selected local main.lynx.bundle
  -> call Lynx loadTemplate with initial data
  -> Lynx first-screen callback
```

Only the selected local bundle may be opened. Do not scan release directories,
read sidecars, recompute SHA-256, inspect ZIPs, delete cache entries, calculate
the Expo fingerprint, contact the Worker, or hop through an asynchronous actor
or background dispatch queue after managed source resolution starts. One main
run-loop scheduling step used to finish React prop/layout application may occur
before source resolution; it must not wrap bundle file I/O.

The installed ZIP hash was verified once during installation. A normal cached
open performs only bounded metadata/path checks and an exact runtime comparison.
The local main bundle mapping is the input required by Lynx; it is not delivery
maintenance.

`LynxManagedDeploymentState` may keep serialized mutation methods. It must also
provide one immutable synchronous launch snapshot so initial source selection
does not wait for an actor task. Interrupted-attempt recovery may be persisted
after the local render starts; the snapshot must never choose the attempting
release as the first source.

### First-screen and reload gates

Register the view for delivery immediately, but keep two states for the exact
load generation:

- `firstScreenReady` opens only from `lynxViewDidFirstScreen`; and
- `reloadReady` opens only after both `firstScreenReady` and the existing
  successful `didLoadFinishedWithUrl` health boundary.

The first-screen callback emits the existing successful `onLoad` event exactly
once, allowing the host splash to uncover the already rendered Lynx page.
Delivery work waits for `reloadReady`, preventing state mutation or background
work from overlapping the remainder of the initial Lynx load:

```text
first screen for current generation
  -> emit onLoad and reveal the local render
  -> matching load-finished callback
  -> start Worker check
  -> download/install if needed
  -> reconcile cache
```

Do not add a second public `onFirstScreen` event. The existing `onLoad`
contract already means that Lynx successfully rendered the selected bundle.
`didLoadFinishedWithUrl` remains the internal candidate-health boundary, but
by itself cannot open either gate because Lynx exposes the first-screen callback
specifically for completion of first-screen layout. Candidate confirmation and
forced-reload completion therefore wait for `reloadReady`, regardless of which
callback arrives first.

Before the first-screen gate opens:

- emit no `checking`, `downloading`, or delivery-error event that can replace or
  hold the first-render splash;
- do not start URLSession, hashing, extraction, cache reconciliation, or D1/R2
  work;
- do not execute a force reload, including one requested by an imperative check;
  queue it until `reloadReady` or discard it if that generation disappears;
  and
- do not call `loadTemplate` twice for the same generation.

If the selected cached bundle fails before first screen, select the compatible
embedded fallback without starting delivery and open the first-screen gate only
after that fallback reaches first screen. A failed or cancelled generation
must never start its queued delivery task.

After the first-screen gate, `force: false` downloads/stages without touching
the displayed view. `force: true` may intentionally reload only after
`reloadReady`, signature/runtime verification, download, and installation all
succeed.

## Cache maintenance

Old runtime directories may remain until normal quota reconciliation can evict
them. Startup must not synchronously delete or rehash every old release.

Cache cleanup must not delete a release protected by another live state
namespace. If the current reconciliation code cannot prove that, defer old
runtime deletion instead of risking data loss.

## Acceptance criteria

- [ ] `runtimeVersion` is persisted in every newly completed installation.
- [ ] Pending and active lookup both require exact runtime equality before
      returning a bundle URL.
- [ ] A native update with a new fingerprint opens the new embedded bundle and
      never opens the old cached bundle, including while offline.
- [ ] A native update with the same fingerprint may continue the active remote
      bundle.
- [ ] A legacy completion marker without runtime metadata falls back to
      embedded without crashing or becoming active.
- [ ] A runtime mismatch does not add the release ID to `failedReleaseIDs`.
- [ ] State, ETag, revision, pending, active, previous, attempting, and failed
      IDs from one runtime cannot affect another runtime.
- [ ] Disabled, force false, force true, rollback, and last-known-good behavior
      remain unchanged within one runtime.
- [ ] Runtime selection performs no network, fingerprint calculation, hashing,
      ZIP work, directory scan, cleanup, or asynchronous actor hop.
- [ ] Local bundle bytes are supplied to `loadTemplate` without an asynchronous
      file-read gap.
- [ ] Worker checking and cache reconciliation begin only after both
      `lynxViewDidFirstScreen` and `didLoadFinishedWithUrl` for the current
      generation.
- [ ] The current generation emits `onLoad` exactly once from its first-screen
      callback so a host splash does not cover usable Lynx content.
- [ ] A pending candidate is not confirmed until both its first-screen and
      matching load-finished callbacks have arrived.
- [ ] A force request cannot issue a second `loadTemplate` while the initial
      first-screen or load-finish pipeline is running.
- [ ] A force response available during startup produces one initial
      `loadBundleStart`/`load_template_start` sequence; any forced reload starts
      a separate sequence only after first screen.
- [ ] `onLoadStart` through first screen contains no delivery progress event or
      delivery-controlled splash transition.
- [ ] A pre-first-screen cache failure falls back to embedded before delivery
      begins.
- [ ] Stale/cancelled first-screen callbacks cannot start delivery for another
      generation.

## Required verification

```bash
pnpm --filter expo-lynx exec jest --runInBand --no-watchman
node --test packages/expo-lynx/app.plugin.test.js
swiftc -parse <each-touched-standalone-swift-file>
git diff --check
```

Add focused fixtures for same-runtime reopen, different-runtime App Store
upgrade, legacy completion, pending mismatch, active mismatch, and offline
fallback. Add an ordering check proving `loadTemplate -> first screen -> Worker
check -> reconciliation`, including a force response arriving during initial
load. Do not start Xcode, a simulator, CocoaPods, or an iOS build.

## Out of scope

- Purging every old runtime immediately, migrating an unverifiable legacy
  release, comparing app-store build numbers, or changing enabled/force
  semantics.
