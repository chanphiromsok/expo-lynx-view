# Android parity for `expo-lynx-view`

**Status:** draft · **Platform:** Android · **Baseline:** `7361f5c`

iOS has been through a full concurrency / lifecycle / first-render remediation
(`docs/ios-concurrency-lifecycle-remediation.md`, findings F1–F27). Android has
a complete-looking implementation of the same surface — view, template provider,
managed delivery, Glide-backed fast image — that has not had an equivalent pass.
This document says what "fully working on Android" means and how we will know we
got there.

Everything below was read out of the tree at the baseline commit. Claims marked
**[verify]** are inferences that still need a runtime check; everything else is
established from source.

---

## Current state

What exists today, so the acceptance criteria have something to be measured
against.

| Area | Android | iOS | Gap |
| --- | --- | --- | --- |
| View + props (`url`, `sourceJSON`, `initialDataJSON`) | ✅ `ExpoLynxView.kt` | ✅ | none |
| Events (`onLoadStart` / `onLoad` / `onError` / `onUpdate`) | ✅ | ✅ | payload shape differs (B6) |
| Source kinds (development / embedded / managed) | ✅ | ✅ | none |
| Managed delivery (store, state, coordinator, config) | ✅ `delivery/` | ✅ `Delivery/` | robustness (B1–B3) |
| `<x-lynx-fast-image>` | ✅ Glide | ✅ SDWebImage | none |
| `<image>` (Lynx built-in) | ❌ no `ILynxImageService` | ✅ | C1 |
| `checkForUpdate` reachable from JS | ❌ registered view-scoped | ✅ module-scoped | **A1** |
| `prewarmRuntime` | ❌ absent | ✅ | **A2** |
| Load-generation guard | ❌ | ✅ F1 / F8 | B1 |
| Candidate-release watchdog | ❌ | ✅ 15s | B2 |
| Resource-root path containment | ❌ | ✅ | B4 |
| Config plugin (embedded assets, delivery config) | ✅ | ✅ | none |

The Android module is not a stub. The work is closing specific holes, not
building the platform out from nothing.

---

## Goal

Make Android a first-class target of `expo-lynx-view`: an app that renders and
updates a Lynx bundle correctly on iOS should behave the same on Android when
run against the same JS, with the same public API, the same event payloads, and
the same failure modes — without the caller branching on `Platform.OS`.

Three things follow from that and are worth stating separately, because they are
what "fully working" actually decomposes into:

1. **The JS API is honest on Android.** Every function the TypeScript surface
   declares either works or is documented and guarded as a no-op. Today
   `checkForUpdate` is neither.
2. **Managed delivery cannot hang or corrupt its state.** A release either
   confirms, fails, or times out — never silently strands a promise or confirms
   a release the view did not actually render.
3. **Divergences are deliberate and written down.** Some are legitimate — Lynx's
   Android SDK genuinely has no separate first-screen callback — and those
   should be documented rather than faked.

Explicit non-goal: matching iOS's *first-render performance* numbers. Android's
threading model, view sizing, and runtime warm-up differ enough that the iOS
optimisations (F10–F18) do not transfer mechanically. Performance work is a
separate effort once correctness parity lands.

---

## Scope

Work is grouped by tier. **Tier A blocks the release; tiers B and C do not, but
B should not slip far behind A.**

### Tier A — API contract (blocking)

**A1. `checkForUpdate` is unreachable from JS on Android.**

`ExpoLynxModule.kt` registers it inside the `View(ExpoLynxView::class)` block.
`ViewDefinitionBuilder.build()` stamps every function declared there with
`ownerType = viewType` / `canTakeOwner = true` and returns them as
`ViewManagerDefinition.asyncFunctions` — they are view-manager functions,
dispatched through a view ref, not module functions. But
`src/ExpoLynxModule.ts` calls it as `nativeModule.checkForUpdate(options.feature)`.

This is the same defect class as F19 (`prewarmRuntime` rejecting on Android),
except F19 was found and guarded and this one was not. Note the F19 comment in
`ExpoLynxModule.ts` asserts "the Android module registers only `checkForUpdate`
and the view-scoped `reload`" — that comment is wrong about `checkForUpdate` and
should be corrected as part of this fix.

Fix: move the `AsyncFunction("checkForUpdate")` registration out of the `View`
block to module scope, alongside `OnCreate`. **[verify]** with one runtime call
from the example app before and after.

**A2. `prewarmRuntime` does not exist on Android.**

The TS capability check (F19) means callers get a resolved promise rather than a
rejection, so nothing breaks — but the documented warm-up simply does not happen,
and Android pays engine init at first mount.

**Decided (2026-09-10): documented no-op.** A real Android warm-up means building
a background Lynx runtime/shell, which is coupled to Android's threading and
sizing model — the same reason first-render performance is an explicit non-goal
of this document. The limitation is now stated in the `ExpoLynxModule.ts`
docstring, a `:::caution[iOS only]` block on the docs-site reference page, and a
comment in `ExpoLynxModule.kt` where the other `AsyncFunction`s are registered.
Revisit under separate Android performance work.

### Tier B — correctness and robustness

**B1. No load-generation guard.** iOS threads a `loadGeneration` (F1) plus a
per-load `loadToken` (F8) through every async continuation. Android has a
`loadScheduled: Boolean` and a mutable `target`, and async completions read
`target` at completion time. A load superseded between dispatch and completion
can therefore have its `onLoadSuccess` attributed to the *new* target — which
calls `ManagedDeploymentState.confirm(...)`, marking a release healthy on the
strength of a different release's render. Introduce a generation counter and
check it in `onLoadSuccess`, `onReceivedError`, and the `startManagedDelivery`
callbacks.

**B2. No watchdog on a candidate release.** `ManagedDeliveryCoordinator.reloadOrStage`
fans out to every registered view and waits for `complete`. If Lynx fires neither
`onLoadSuccess` nor `onReceivedError` — the case iOS's 15s `startWatchdog` →
`failCandidate` exists for — `finished` stays false and the JS promise never
settles. `destroy()` does resolve the completion, so the unmount path is covered;
the never-called-back path is not. Add a deadline that fails the candidate and
settles the promise.

Related, same function: a single view whose `forceReloadManagedRelease` mismatches
completes with failure immediately, which sets `finished` and reports the whole
batch as failed even when the other views would have rendered fine. Decide whether
a mismatched view should abort the batch or be skipped.

**B3. `ManagedDeploymentState(context)` is constructed per call site** — five of
them, each opening MMKV. iOS holds one instance. Make it a singleton or inject one.

**B4. The template provider has no path containment.** `LynxTemplateProvider.loadTemplate`
resolves the non-scheme branch as `File(localResourceRoot, uri)` with no check that
the result stays inside the root and no rejection of `..` segments. iOS enforces
both in `existingFileURL` / `normalizedComponents`. Bundle-relative resource names
come from template content, so this is worth closing on principle even where the
current inputs are trusted.

**B5. Thread-per-resource-load.** The provider starts a bare `Thread` per load in
all three branches. Move to a bounded executor.

**B6. Error payload divergence.** Android emits `error.errorCode.toString()` as
`code`; iOS emits structured `ERR_LYNX_*` values. Anything in JS switching on
`code` is platform-specific today. Align on the iOS vocabulary and keep the SDK
code in a separate field.

### Tier C — feature gaps and hygiene

**C1. No `ILynxImageService`,** so Lynx's built-in `<image>` does not render;
only `<x-lynx-fast-image>` works. `android/build.gradle` records the reason
(Fresco conflicts with host dependencies). Either ship a Glide-backed
`ILynxImageService` — the Glide dependency is already there — or document
`<image>` as iOS-only.

**C2. `@RequiresApi(Build.VERSION_CODES.P)` sits on the whole `definition()`**,
i.e. API 28, while the module declares no `minSdk` of its own and inherits the
Expo/RN default (24 at RN 0.86). If that is real, the module is annotated for a
floor it does not enforce. **[verify]** the effective merged `minSdk`, then either
raise it, narrow the annotation to the call that needs it, or drop it.

**C3. `OnViewDidUpdateProps` is not used on Android** — `scheduleLoad`'s `post {}`
coalescing achieves the same batching. This is a legitimate divergence; document
it rather than "fixing" it.

**C4. `first_screen_ms` is logged equal to `load_finished_ms`,** because the
Android SDK has no separate first-screen callback. Already commented in code.
Surface it wherever IFR metrics are documented so the two platforms' numbers are
not compared naively.

### Out of scope

- First-render performance parity (iOS F10–F18).
- Web (`ExpoLynxModule.web.ts`).
- `lynx-screens` / navigation linking — iOS-side work in flight on `app.plugin.js`.
- Any change to the iOS implementation.

---

## Acceptance criteria

Each is observable. "Parity" that cannot be demonstrated does not count.

### API contract

1. `ExpoLynxModule.checkForUpdate({ feature })` called from the example app on a
   physical or emulated Android device resolves with a `LynxBundleUpdateResult`
   whose shape matches the iOS result for the same feature and server state. It
   must not reject with "not a function".
2. `ExpoLynxModule.prewarmRuntime()` resolves on Android. If it stays a no-op,
   the docstring in `ExpoLynxModule.ts` and the docs site both say so; if it is
   implemented, a second call while a build is in flight is a no-op, matching the
   documented iOS behaviour.
3. The corrected F19 comment in `ExpoLynxModule.ts` describes what the Android
   module actually registers.

### Managed delivery

4. A managed update that renders successfully moves the release to `active` and
   emits `onUpdate` with `phase: "reloaded"` — same phases, same order as iOS.
5. A candidate release that fails to render is marked failed, falls back to the
   last good release (or embedded), and settles the `checkForUpdate` promise with
   an error. No hang.
6. **Watchdog:** with Lynx stubbed to fire neither callback, `checkForUpdate`
   settles within the deadline instead of hanging. This is the B2 regression test
   and it must exist as an automated test, not a manual check.
7. **Generation:** two loads issued back to back result in exactly one confirmed
   release, and it is the second one. Assert on `ManagedDeploymentState` contents,
   not on rendered output.
8. Unmounting a view mid-force-reload settles its completion (already true; keep a
   test so it stays true).

### Resource loading

9. A template requesting `../` outside its resource root fails to load rather than
   resolving. Unit test against `LynxTemplateProvider`.
10. Concurrent resource loads run on a bounded executor — assert the thread count
    does not scale with the number of in-flight requests.

### Payloads

11. For each of: bundle-not-found, malformed source JSON, network failure, and
    render error, the `onError` payload from Android carries the same `stage` and
    `code` as iOS for the equivalent condition. A table-driven test across both
    platforms is the goal; a documented table is the minimum.

### Build

12. The example app builds and runs on Android at the repo's declared `minSdk`
    with no `@RequiresApi` mismatch.
13. `./gradlew :expo-lynx:lint` reports no new warnings. (`lintOptions.abortOnError
    false` is set today — that stays, but the baseline should not grow.)

### Documentation

14. Every remaining intentional divergence — `<image>`, first-screen metrics,
    `OnViewDidUpdateProps`, and `prewarmRuntime` if it stays a no-op — is listed
    in one place a user will actually find.

---

## Dependencies

### Runtime and toolchain

| Dependency | Version | Note |
| --- | --- | --- |
| `org.lynxsdk.lynx:lynx` | 4.0.0 | Matches the iOS pod. Bump both together. |
| `lynx-jssdk`, `lynx-trace`, `primjs` | 4.0.0 | |
| `xelement`, `xelement-input` | 4.0.0 | Required for `<input>` / `<textarea>`. |
| `lynx-service-log`, `lynx-service-http` | 4.0.0 | Registered in `OnCreate`. |
| `com.squareup.okhttp3:okhttp` | 4.9.0 | Provider network branch. |
| `com.tencent:mmkv` | 1.3.17 | Managed deployment state. |
| `com.github.bumptech.glide:glide` | 5.0.5 | Fast image. Matches Expo Image 57.x so the host resolves one Glide. **No `@GlideModule` is declared** — do not add one without checking expo-image's `AppGlideModule`. |
| Expo Modules Core | 57.0.x | `ViewDefinitionBuilder` semantics in A1 are version-sensitive; re-verify on upgrade. |
| React Native | 0.86.x | Sets the inherited `minSdk` relevant to C2. |
| AGP / Gradle | 8.12 / 8.9 | Per the checked-in wrapper. |

### Blocked-on decisions

These need an answer before the work they gate can start:

- ~~**`prewarmRuntime` on Android** (A2): implement, or document as iOS-only?~~
  **Decided: documented no-op** (see A2 above). Acceptance criterion 2 met by
  the docstring + docs-site caution.
- **`<image>` support** (C1): ship a Glide-backed `ILynxImageService`, or document
  the limitation? Gates criterion 14, and the answer changes whether Glide becomes
  load-bearing for core rendering rather than one custom element.
- **Batch semantics in `reloadOrStage`** (B2): does one mismatched view abort the
  batch, or is it skipped? Gates criterion 5.
- **Effective `minSdk`** (C2): needs measuring before the annotation can be fixed
  in either direction.

### Ordering

A1 first — it is small, it is the only thing that makes managed delivery reachable
from JS at all, and every delivery-related acceptance criterion depends on being
able to call `checkForUpdate`. Then B1 and B2 together, since a watchdog without a
generation guard can fail the wrong candidate. Everything else is independent.

### Cross-platform

No iOS change is required by this work. If any Tier B fix suggests a matching iOS
change, file it against the F-series in `docs/ios-concurrency-lifecycle-remediation.md`
rather than widening this document.
