# ExpoLynx iOS — concurrency, lifecycle & first-render remediation spec

**Scope:** `packages/expo-lynx/ios/View/ExpoLynxView.swift`, `packages/expo-lynx/ios/View/ExpoLynxTemplateProvider.swift`, `packages/expo-lynx/ios/Module/ExpoLynxModule.swift`
**Branch:** `perf/lynx-startup`
**SDK under wrap:** Lynx `4.0.0` (`Lynx/Framework`), verified against the vendored pod sources at `apps/lynx-example/ios/Pods/Lynx/platform/darwin`.

---

## 0. Why this document exists

The wrapper's correctness depends on Lynx's *actual* threading contract, which is not documented in the public headers. Reading the pod sources established three facts that invalidate assumptions currently baked into the code:

| Fact | Evidence |
| --- | --- |
| `lynxViewDidFirstScreen` **is** delivered on the main thread. | `LynxView.mm:1120` wraps it in `dispatch_async(dispatch_get_main_queue(), …)`. |
| `didLoadFinishedWithUrl:` and `didRecieveError:` are **not**. They run on the producing thread. | `LynxView.mm:1141` and `LynxView.mm:829-839` call the dispatcher directly, with no hop. The producing thread for resource failures is our own provider's completion queue (`LynxTemplateRender.mm:659` → `onFetchTemplateError` → `onErrorOccurred` → `dispatchError`). |
| `clearForDestroy` **silently skips UI teardown** when called off-main. | `LynxView.mm:129-146` branches on `[NSThread isMainThread]`; the `else` branch (`[_templateRender.lynxUIRenderer reset]`) is the only path that actually tears down. |

Two further facts constrain the fixes:

- Lifecycle clients are held in a **weak** `NSHashTable` (`LynxLifecycleDispatcher.m:18`), so `addLifecycleClient` creates **no retain cycle**, and the `removeLifecycleClient` call in `deinit` is a no-op (weak refs are already zeroed by then).
- `LynxBackgroundRuntimeOptions` takes the three resource fetchers **at construction** (`LynxBackgroundRuntime.h:75-78`) and `LynxBackgroundRuntime` exposes no setter. A prewarmed runtime's fetcher identity is therefore fixed before any view exists.

The codebase compiles in Swift 5 language mode — `ExpoLynx.podspec` sets no `SWIFT_STRICT_CONCURRENCY` — so every actor-isolation violation below is currently silent.

---

## 1. Finding index

| ID | Severity | Summary | Phase |
| --- | --- | --- | --- |
| F1 | High | Lynx lifecycle callbacks arrive off-main; the load state machine races. | 1 |
| F2 | High | `deinit` off-main skips Lynx UI teardown and dispatches an error mid-dealloc. | 1 |
| F3 | High | `deinit` resumes a `@MainActor` `CheckedContinuation` from a nonisolated context. | 1 |
| F4 | High | Prewarmed runtime uses `ExpoLynxTemplateProvider.shared`, whose root is never set. | 2 |
| F5 | High | `failCandidate` guard swallows errors and hangs the force-reload continuation. | 3 |
| F6 | Medium | `didLoadFinishedWithUrl` URL equality breaks against our own `shouldRedirectUrl`. | 3 |
| F7 | Medium | `localResourceRoot` is ambient state; overlapping loads resolve against the wrong root. | 2 |
| F8 | Medium | `loadTarget` resets the gate without invalidating in-flight decodes. | 3 |
| F9 | Medium | Warmer can wedge `building`; warm runtime is never reclaimed. | 4 |
| F10 | Perf | MMKV init + `createDirectory` + mmap on main inside `init`. | 5 |
| F11 | Perf | `scheduleLoad`'s main hop costs a runloop turn on the critical path. | 5 |
| F12 | Perf | Load can start before the first viewport, forcing a second layout pass. | 5 |
| F13 | Perf | Several synchronous `stat`s on main per load. | 5 |
| F14 | Perf | `LynxTemplateData(json:)` parsed on main. | 5 |
| F15 | Perf | Decoded bundle discarded when the view unmounts mid-decode. | 5 |
| F16 | Perf | `updateViewport(needLayout: true)` runs synchronously inside `layoutSubviews`. | 5 |
| F17 | Perf | Safe-area seeding causes a second full render right after first screen. | 5 |
| F18 | Perf | `isHidden = false` at load start reveals the stale render. | 5 |

Findings F19-F21 (cloud review cross-check) are in §8; F22-F25 (low severity) are in §9. §8.1 and §8.2 amend Phase 5 — read them before implementing §5.1 or §5.3. §10 is the implementation log; §11 is the post-implementation review of the landed code, and carries two findings the implementation introduced (F26, F27) plus the resolution of F25. §12 is the proposal to fix F26 and F27 — it withdraws one of the three options §11.3 floated, so read §12.1 rather than implementing from §11.3.

---

## Phase 0 — Guardrails (land first, in its own commit)

Make the compiler and runtime surface the bugs before fixing them, so regressions can't creep back.

### 0.1 Opt into targeted concurrency checking

`packages/expo-lynx/ios/ExpoLynx.podspec` — add to `pod_target_xcconfig`:

```ruby
'SWIFT_STRICT_CONCURRENCY' => 'targeted',
```

Expect this to fail the build initially. That is the point: it flags F3 and the `@MainActor` hops in F1 at compile time. Do **not** move to `complete` in this pass — the Lynx ObjC surface is entirely un-annotated and the noise would drown the signal. File a follow-up.

### 0.2 Add a debug thread assertion at the Lynx boundary

Add to `ExpoLynxView`:

```swift
#if DEBUG
  private func assertMain(_ fn: StaticString = #function) {
    assert(Thread.isMainThread, "\(fn) must run on the main thread")
  }
#else
  @inline(__always) private func assertMain(_ fn: StaticString = #function) {}
#endif
```

Call it at the top of every `handle*` method introduced in Phase 1. This converts F1's silent corruption into a debug-build crash at the exact call site.

### 0.3 Enable the sanitizers in the example app scheme

Document (in `docs/`) that `apps/lynx-example` should be run once with **Thread Sanitizer** and **Main Thread Checker** enabled before merging Phase 1. TSan is the only tool that reliably catches the `LynxInitialLoadGate` read-modify-write race.

**Acceptance:** the build fails with concurrency diagnostics that map to F1/F3, and a TSan run on a managed-delivery load reports at least one race on `ExpoLynxView` state.

---

## Phase 1 — Thread discipline at the Lynx boundary (F1, F2, F3)

These three are one bug wearing three hats and **must land together**. Fixing F2 without F1 leaves the race; fixing F1 without F3 leaves a potential `CheckedContinuation` double-resume, which is a hard crash.

### 1.1 A thread-safe generation mirror

`loadGeneration` currently can only be read safely on main, but the trampoline in 1.2 needs to snapshot it from a Lynx thread. Add a small lock-boxed mirror:

```swift
/// `loadGeneration` is main-actor state, but Lynx delivers two of the three
/// lifecycle callbacks on its own threads (LynxView.mm:1141, :838) and those
/// trampolines must snapshot the generation *before* hopping — otherwise a
/// callback produced by load N is applied to load N+1.
private final class LoadGenerationBox {
  private let lock = NSLock()
  private var value = 0

  func set(_ newValue: Int) {
    lock.lock(); defer { lock.unlock() }
    value = newValue
  }

  var current: Int {
    lock.lock(); defer { lock.unlock() }
    return value
  }
}
```

Wire it to the existing counter so there is exactly one place that can drift:

```swift
private let generationBox = LoadGenerationBox()
private var loadGeneration = 0 {
  didSet { generationBox.set(loadGeneration) }
}
```

### 1.2 Trampoline every lifecycle callback

Replace the three `LynxViewLifecycle` methods with thread-normalising entry points. Keep the synchronous branch so the common (already-main) case adds no runloop turn:

```swift
private func onMain(_ work: @escaping () -> Void) {
  if Thread.isMainThread {
    work()
  } else {
    DispatchQueue.main.async(execute: work)
  }
}

// MARK: - LynxViewLifecycle (thread-normalising entry points)
//
// Lynx guarantees main-thread delivery only for lynxViewDidFirstScreen
// (LynxView.mm:1120). didLoadFinishedWithUrl: and didRecieveError: are invoked
// synchronously on the producing thread — for resource failures that is this
// module's own ExpoLynxTemplateProvider completion queue. Snapshot the
// generation here, then hop; the handlers below are main-thread-only.

func lynxView(_ view: LynxView, didLoadFinishedWithUrl url: String) {
  let generation = generationBox.current
  onMain { [weak self] in self?.handleLoadFinished(url: url, generation: generation) }
}

func lynxViewDidFirstScreen(_ view: LynxView) {
  let generation = generationBox.current
  onMain { [weak self] in self?.handleFirstScreen(generation: generation) }
}

func lynxView(_ view: LynxView, didRecieveError error: Error) {
  let generation = generationBox.current
  onMain { [weak self] in self?.handleError(error, generation: generation) }
}
```

Each `handle*` method begins with `assertMain()` and:

```swift
guard generation == loadGeneration else { return }
```

Move the existing bodies of `lynxView(_:didLoadFinishedWithUrl:)`, `lynxViewDidFirstScreen(_:)` and `lynxView(_:didRecieveError:)` into `handleLoadFinished`, `handleFirstScreen` and `handleError` unchanged apart from that guard. In `handleError`, read `lynxView` (the stored property) rather than the `view` parameter, and read `lynxView.url` on main.

**Ordering note to call out in review:** hopping `didRecieveError` changes delivery order relative to a synchronous error raised inside `loadTemplate`. The generation guard makes that safe — a stale-generation error is dropped rather than misapplied — but it means an error and a first-screen for the *same* generation may now interleave differently. `LynxInitialLoadGate`'s `consumed` latch already handles that, and after this change it is only ever touched on main.

### 1.3 Make `deinit` safe

```swift
deinit {
  deliveryTask?.cancel()
  watchdogWorkItem?.cancel()

  // The completions below reach a @MainActor ReloadCompletion (see 1.4) and
  // clearForDestroy silently skips `[_templateRender.lynxUIRenderer reset]`
  // when it is not on the UI thread (LynxView.mm:129-146). deinit is
  // nonisolated even for a UIView subclass, so both must be hopped.
  let pendingCompletions = [forceReloadCompletion, deferredForceReload?.completion].compactMap { $0 }
  let view = lynxView
  let owner = ObjectIdentifier(self)

  let teardown = {
    for completion in pendingCompletions { completion(.failure(CancellationError())) }
    ExpoLynxResourceRoots.shared.removeOwner(owner)   // see Phase 2
    view.clearForDestroy()
  }

  if Thread.isMainThread {
    teardown()
  } else {
    DispatchQueue.main.async(execute: teardown)
  }
}
```

Three deliberate changes:

- **`removeLifecycleClient(self)` is dropped.** It is provably a no-op: the dispatcher's hash table is `NSPointerFunctionsWeakMemory`, so the entry has already zeroed by the time `deinit` runs. Leave a comment recording why, so nobody re-adds it.
- **`self` is never captured.** The closure captures `view`, the completion list, and an `ObjectIdentifier` — all safe to escape a deallocating object. Capturing `self` in a `deinit` escape is undefined behaviour.
- **`clearForDestroy` is called on main and remains idempotent** (`_templateRender = nil`), so `LynxView.dealloc`'s own call at `LynxView.mm:119` is harmless.

### 1.4 Restore isolation at the completion boundary (F3)

`LynxManagedViewRegistry.ReloadCompletion` is `@MainActor`, but the closure is erased to a nonisolated function type at the `forceReloadManagedRelease` parameter. Re-annotate so the compiler enforces it:

```swift
// ExpoLynxView.swift
func forceReloadManagedRelease(
  _ release: LynxManagedRelease,
  completion: @escaping @MainActor (Result<Void, Error>) -> Void
)

private func performForceReload(
  _ release: LynxManagedRelease,
  completion: @escaping @MainActor (Result<Void, Error>) -> Void
)
```

and update the two stored properties:

```swift
private var forceReloadCompletion: (@MainActor (Result<Void, Error>) -> Void)?
private var deferredForceReload:
  (release: LynxManagedRelease, completion: @MainActor (Result<Void, Error>) -> Void)?
```

With Phase 0.1's `targeted` checking this makes the `deinit` call site an error until 1.3 lands, which is the desired forcing function.

**Acceptance for Phase 1:**
- TSan reports no races on `ExpoLynxView` state across: cold managed load, forced reload, load failure via a 404 resource, and unmount-during-load.
- Main Thread Checker is silent during mount/unmount.
- A debug build with a deliberately failing resource URL hits `handleError` on main and does **not** trip `assertMain`.
- Unmounting a view mid-load produces no `ECLynxThreadWrongThreadDestroyError` in the Lynx log.

---

## Phase 2 — Resource resolution correctness (F4, F7)

### 2.1 The constraint

`ExpoLynxRuntimeWarmer.makeOptions()` must supply fetchers at runtime-construction time, before any `ExpoLynxView` exists, and the fetchers cannot be swapped later. `ExpoLynxTemplateProvider.shared` is therefore the only possible fetcher for a prewarmed runtime — and its `localResourceRoot` is never set, because only the per-view instance receives `setLocalResourceRoot`. A managed release's sidecar resources live in the caches directory and are consequently unresolvable, but only when prewarm happened to win the race.

The same ambient-state design causes F7: `loadTarget` mutates the root while the previous load's fetches are still in flight.

Both are fixed by replacing "one mutable root per provider" with "a process-wide registry of currently-valid roots".

### 2.2 New type: `ExpoLynxResourceRoots`

New file `packages/expo-lynx/ios/View/ExpoLynxResourceRoots.swift`:

```swift
import Foundation

/// Process-wide registry of directories that Lynx resource resolution is
/// allowed to read from, in addition to the app bundle.
///
/// Exists because a prewarmed `LynxBackgroundRuntime` has its resource
/// fetchers baked in at construction (LynxBackgroundRuntime.h:75-78) and can
/// only ever hold `ExpoLynxTemplateProvider.shared` — an instance that has no
/// view, and therefore no per-view root. Routing every provider through this
/// registry means the warm-runtime path and the per-view path resolve
/// identically.
///
/// Roots are kept per owner, newest first, with the previous root retained so
/// that resource fetches still in flight from a superseded load continue to
/// resolve. Entries are dropped when the owning view tears down.
final class ExpoLynxResourceRoots {
  static let shared = ExpoLynxResourceRoots()

  private let lock = NSLock()
  private var rootsByOwner: [ObjectIdentifier: [URL]] = [:]
  private var ownerOrder: [ObjectIdentifier] = []

  /// Retain at most the current and immediately-previous root per owner.
  private static let historyDepth = 2

  func setRoot(_ url: URL?, owner: ObjectIdentifier) {
    lock.lock(); defer { lock.unlock() }

    ownerOrder.removeAll { $0 == owner }
    ownerOrder.insert(owner, at: 0)

    guard let url else {
      rootsByOwner[owner] = []
      return
    }
    var history = rootsByOwner[owner] ?? []
    history.removeAll { $0 == url }
    history.insert(url, at: 0)
    rootsByOwner[owner] = Array(history.prefix(Self.historyDepth))
  }

  func removeOwner(_ owner: ObjectIdentifier) {
    lock.lock(); defer { lock.unlock() }
    rootsByOwner.removeValue(forKey: owner)
    ownerOrder.removeAll { $0 == owner }
  }

  /// Most-recently-active owner first, then that owner's newest root first.
  func currentRoots() -> [URL] {
    lock.lock(); defer { lock.unlock() }
    return ownerOrder.flatMap { rootsByOwner[$0] ?? [] }
  }
}
```

`ObjectIdentifier` rather than a weak `AnyObject` keeps this usable from `deinit` (see 1.3), where taking a strong or weak reference to the deallocating view is not permitted.

### 2.3 Rework `ExpoLynxTemplateProvider`

Replace the single `localResourceRoot` with a *preferred* root plus registry fallback:

```swift
private let resourceRootLock = NSLock()
private var preferredResourceRoot: URL?

func setLocalResourceRoot(_ url: URL?) {
  resourceRootLock.lock()
  preferredResourceRoot = url
  resourceRootLock.unlock()
}

/// Ordered candidate roots: this provider's own root first (the per-view
/// instance), then every root registered by a live view (this is the only
/// source available to `.shared`, which backs prewarmed runtimes), then the
/// app bundle.
private func candidateRoots() -> [URL] {
  resourceRootLock.lock()
  let preferred = preferredResourceRoot
  resourceRootLock.unlock()

  var roots: [URL] = []
  if let preferred { roots.append(preferred) }
  for root in ExpoLynxResourceRoots.shared.currentRoots() where !roots.contains(root) {
    roots.append(root)
  }
  if let bundleRoot = Bundle.main.resourceURL, !roots.contains(bundleRoot) {
    roots.append(bundleRoot)
  }
  return roots
}
```

`bundledResourceURL(for:)` then becomes a straight loop over `candidateRoots()`, preserving the existing containment check in `existingFileURL` — the sandbox property is unchanged, only the set of permitted roots grows to include live views' roots:

```swift
func bundledResourceURL(for value: String) -> URL? {
  let roots = candidateRoots()
  guard !roots.isEmpty else { return nil }

  if let fileURL = URL(string: value), fileURL.isFileURL {
    return roots.lazy.compactMap { existingFileURL(fileURL, inside: $0) }.first
  }

  guard let components = normalizedComponents(value) else { return nil }
  return roots.lazy.compactMap { existingResourceURL(root: $0, components: components) }.first
}
```

Extract the existing `bundle://` stripping / `..` rejection block into `normalizedComponents(_:)` unchanged — it is already correct and should not be touched in this pass.

### 2.4 Register from the view

In `loadTarget`, alongside the existing `templateProvider.setLocalResourceRoot(...)` calls, mirror into the registry:

```swift
let root: URL? = {
  if target.source == "cache", let bundleURL = URL(string: target.url), bundleURL.isFileURL {
    return bundleURL.deletingLastPathComponent()
  }
  if target.source == "embedded", let bundleURL = resolveLocalURL(target.url) {
    return bundleURL.deletingLastPathComponent()
  }
  return nil
}()
templateProvider.setLocalResourceRoot(root)
ExpoLynxResourceRoots.shared.setRoot(root, owner: ObjectIdentifier(self))
```

Teardown is already handled by 1.3.

**Acceptance for Phase 2:**
- With `prewarmRuntime` called and a managed release whose bundle references a sidecar asset, the asset resolves. Verify by asserting the same rendered output with prewarm forced on and forced off (add a debug-only flag to disable `take()`).
- Starting load B while load A's resource fetch is in flight leaves A's fetch resolvable (root history depth 2).
- Path traversal is still rejected: `bundle://../../etc/passwd` and an absolute file URL outside every registered root both return `nil`. Add these as cases to a new `ExpoLynxTemplateProviderFixtureTest.swift` under `ios/tests/`, matching the existing fixture-test style.

---

## Phase 3 — Managed-delivery robustness (F5, F6, F8)

### 3.1 F5 — `failCandidate` must always report and always unblock

The guard at `ExpoLynxView.swift:1126` returns before doing *any* work when `target.managedRuntimeVersion` is `nil` — which is reachable, because `loadManagedRelease` populates it with `try?` (`ExpoLynxView.swift:682`). The caller in `handleError` `return`s immediately after, so the error is dropped entirely, the watchdog is never cancelled, and `forceReloadCompletion` is never invoked, hanging `reloadMountedViews`' continuation for the process lifetime.

Restructure so the unconditional obligations run first and only the deployment-state bookkeeping is gated:

```swift
fileprivate func failCandidate(_ target: ExpoLynxLoadTarget, error: Error, generation: Int) {
  assertMain()

  // Unconditional: these must happen even when the release metadata is
  // incomplete, or the error is swallowed and the force-reload continuation
  // never resumes. `managedRuntimeVersion` is populated with `try?` and can
  // legitimately be nil.
  watchdogWorkItem?.cancel()
  watchdogWorkItem = nil

  if currentLoadGate.hasFirstScreen {
    emitDeliveryError(error, fallbackURL: target.url, feature: target.feature)
  } else {
    deferredDeliveryError = (error, target.url, target.feature)
  }
  forceReloadCompletion?(.failure(error))
  forceReloadCompletion = nil
  deferredForceReload?.completion(.failure(error))
  deferredForceReload = nil
  deliveryTask?.cancel()

  guard generation == loadGeneration else { return }

  guard let manifestID = target.candidateManifestID,
    let feature = target.managedFeature,
    let runtimeVersion = target.managedRuntimeVersion
  else {
    // Cannot record the failure or pick a fallback release without the full
    // triple. Fall back to the embedded bundle so the view is not left blank.
    if let feature = target.managedFeature ?? managedFeature {
      loadEmbedded(feature: feature, generation: generation)
    }
    return
  }

  // …existing fail/recover/reload-active/fallback-embedded logic, unchanged…
}
```

Separately, tighten the source of the `nil`: in `loadManagedRelease`, resolve the runtime version once and treat failure as a delivery error rather than silently degrading.

### 3.2 F6 — normalise the load-finished URL comparison

`guard url.isEmpty || url == target.url` at `ExpoLynxView.swift:1178` compares raw strings, but `ExpoLynxTemplateProvider.shouldRedirectUrl` actively rewrites request URLs to `absoluteString` file URLs. A mismatch means `recordLoadFinished()` never runs, the gate never completes, and a healthy managed candidate is failed by the 15-second watchdog.

```swift
/// Lynx may report the post-redirect URL, and `shouldRedirectUrl` rewrites
/// local requests to absolute file URLs. Compare on standardized file paths,
/// falling back to raw string equality for remote URLs.
private static func isSameTemplateURL(_ lhs: String, _ rhs: String) -> Bool {
  if lhs == rhs { return true }
  guard let l = URL(string: lhs), let r = URL(string: rhs) else { return false }
  if l.isFileURL && r.isFileURL {
    return l.standardizedFileURL.path == r.standardizedFileURL.path
  }
  return l.absoluteString == r.absoluteString
}
```

Use it in `handleLoadFinished`. Belt-and-braces: because the generation guard from 1.2 already scopes the callback to the current load, consider demoting the URL check to a debug assertion rather than a hard `return` — a false negative here is far more damaging (a 15s stall) than a false positive.

### 3.3 F8 — per-load token so a superseded decode cannot land

`performForceReload` → `loadManagedRelease` → `loadTarget` resets `currentLoadGate` and `currentTarget` but does **not** bump `loadGeneration`. The in-flight `templateDecodeQueue` callback from the previous load therefore passes the generation check and is stopped only by `currentTarget?.url == target.url` — which also passes when the forced release reuses the same URL.

Rather than overloading `loadGeneration` (which callers pass around as a parameter), add a token that changes on every `loadTarget`:

```swift
private var loadToken = UUID()
```

Set `loadToken = UUID()` in `loadTarget`, capture it in `loadLocalURL`, and replace the `currentTarget?.url == target.url` checks in both the cache fast path and the decode-queue continuation with `token == loadToken`. This also removes the dead comparison on the synchronous fast path, where `currentTarget` was just assigned two lines earlier.

**Acceptance for Phase 3:**
- New fixture test: `failCandidate` with `managedRuntimeVersion == nil` emits an error and invokes the completion with a failure.
- A forced reload to the *same* release URL issued while a decode is in flight results in exactly one `lynxView.load` call for the new token. Assert via a debug counter.
- A managed candidate served through `shouldRedirectUrl` completes its gate and does not trip the watchdog.

---

## Phase 4 — Runtime warmer lifecycle (F9)

### 4.1 Remove the wedge

`ExpoLynxRuntimeWarmer.shared` is a `static let` and never deallocates, so `[weak self]` in `refillIfNeeded`'s `queue.async` buys nothing while encoding a permanent-wedge failure mode: if the guard ever fired, `building` would stay `true` forever and the warmer would never refill again. Capture strongly and clear `building` with `defer` so no future early return can strand it:

```swift
queue.async {
  defer {
    self.lock.lock()
    self.building = false
    self.lock.unlock()
  }
  let options = self.makeOptions()
  #if DEBUG
    let runtime = LynxBackgroundRuntime(options: options, debuggable: true)
  #else
    let runtime = LynxBackgroundRuntime(options: options)
  #endif
  self.lock.lock()
  self.warm = runtime
  self.lock.unlock()
}
```

### 4.2 Reclaim the warm runtime

Every `take()` schedules an unconditional refill, so after the last `ExpoLynxView` unmounts a fully-constructed JSC VM with `lynx_core.js` evaluated sits idle for the rest of the process. Add reclamation:

```swift
private init() {
  NotificationCenter.default.addObserver(
    forName: UIApplication.didReceiveMemoryWarningNotification,
    object: nil,
    queue: nil
  ) { [weak self] _ in self?.drain() }
}

/// Release the warm runtime without scheduling a replacement. The next mount
/// falls back to the stock path, exactly as when prewarm has not run.
func drain() {
  lock.lock()
  warm = nil
  lock.unlock()
}
```

Consider also draining on `didEnterBackgroundNotification`. Do **not** refill from either handler — the host re-primes via `prewarmRuntime` when it next wants the optimisation.

Deliberate non-change: the `take()`/`refillIfNeeded()` unlock-then-relock interleaving and the `building` latch were reviewed and correctly serialise concurrent `prime()` and `take()`. Leave the locking structure alone.

**Acceptance for Phase 4:** simulating a memory warning releases the runtime (observable via a debug counter or Instruments allocations), and a subsequent `prewarmRuntime` rebuilds it.

---

## Phase 5 — First-render performance

This is the branch's stated purpose, so each item names the work being moved and where it goes.

### 5.1 F10 — get MMKV off the mount path

`ExpoLynxView.swift:241-242` calls `LynxManagedDeploymentState.prepareStorage()` and touches `.shared` inside `init`. That runs `MMKV.initialize`, `FileManager.createDirectory` and an mmap — synchronous disk I/O landing on the **first mount**, i.e. exactly at first render. The existing comment justifies the location by `OnCreate` being nonisolated, which is an argument for hopping to main from `OnCreate`, not for blocking in the view initializer.

Move it to the same host-controlled moment as the runtime prewarm:

```swift
// ExpoLynxModule.swift
AsyncFunction("prewarmRuntime") {
  await MainActor.run {
    LynxManagedDeploymentState.prepareStorage()
    _ = LynxManagedDeploymentState.shared
  }
  ExpoLynxRuntimeWarmer.shared.prime()
}
```

Keep the `init` calls as an idempotent safety net for hosts that never call `prewarmRuntime` — `prepareStorage` already guards on `didInitializeMMKV`, and `.shared` is a lazy singleton, so the second call is free. Retain the `LynxIFRLogger.deliveryStorePrepared` instrumentation so the improvement is measurable.

### 5.2 F11 + F12 — fix the load/viewport ordering, then reconsider the hop

These are one item. `scheduleLoad`'s `DispatchQueue.main.async` (`ExpoLynxView.swift:390`) costs a full runloop turn on the critical path and looks redundant — `applyPendingUpdate` is already the "all props applied" callback. **But it is currently load-bearing by accident:** `applyLayout` runs from `init` only when bounds are non-zero, which for an Expo view they are not, so the first `updateViewport` arrives from `layoutSubviews`. The hop is what usually lets layout win the race. Delete it naively and the load starts at a zero viewport, Lynx lays out against it, and then does a **second full layout pass** when the real viewport arrives.

Fix the ordering explicitly, then the hop becomes optional:

1. Add `private var hasViewport = false`, set in `applyLayout`.
2. In `loadTarget`, if `!hasViewport` and `bounds.size` is non-zero, call `applyLayout(bounds.size)` synchronously before `loadTemplate` / `load`.
3. If `bounds.size` is still zero, defer the load: store the pending target and drive it from the next `layoutSubviews` that produces a non-zero size.
4. Only then replace the `DispatchQueue.main.async` with a direct `loadSource(generation:)` call.

Keep the coalescing the hop provided by leaving the `loadGeneration` bump in `scheduleLoad` — back-to-back prop updates within one batch still collapse, because `applyPendingUpdate` fires once per batch.

Measure with `LynxIFRLogger.firstScreen` before and after; the expected win is one runloop turn plus one avoided Lynx layout pass.

### 5.3 F13 — stop stat-ing on the main thread

Per load, `resolveLocalURL` → `bundledResourceURL` → `existingFileURL` performs `fileExists` **and** `hasDirectoryPath` (two stats), `loadEmbedded` probes up to twice more, and `templateCacheKey` adds `attributesOfItem`. Even an `NSCache` hit therefore pays several synchronous filesystem round-trips before reaching `lynxView.load`.

- Memoise embedded-feature resolution in a lock-protected `[String: URL]` on `ExpoLynxTemplateProvider`. Embedded asset paths cannot change within a process, so the cache never needs invalidation.
- Derive `templateCacheKey` from an `URLResourceValues` fetch (`.fileSizeKey`, `.contentModificationDateKey`) performed **once**, on `templateDecodeQueue`, reusing the stat the decode already needs — rather than a separate `attributesOfItem` on main.
- Accept a one-frame cost on the very first embedded load; every subsequent mount is stat-free.

While here, note that `templateCacheKey`'s mtime is truncated to whole seconds. A rebuild at the same path with an identical size inside one second would hit a stale entry. Dev builds go through the remote URL path and managed releases use unique directories, so this is currently unreachable — add a comment recording that, rather than changing the key.

### 5.4 F14 + F15 — finish the decode-queue offload

`consumeTemplateDataForLoad()` runs `LynxTemplateData(json:)` on the main-thread continuation. Build it on `templateDecodeQueue` alongside the bundle and pass it through the `Result` payload. The cache-hit fast path keeps the main-thread construction, which is acceptable because that path has no other work to hide it behind.

Separately, in `loadLocalURL` the `templateBundleCache.setObject` sits **inside** `guard let self` (`ExpoLynxView.swift:868-877`). If the view unmounts mid-decode the work completes but is discarded, and the next mount re-decodes from scratch. Hoist the cache write above the `self` check — it needs only `cacheKey` and `bundle`, both already captured:

```swift
DispatchQueue.main.async {
  if case .success(let (bundle, _)) = outcome, let bundle, let cacheKey {
    // Cache regardless of whether this view still exists: the decode is done
    // and the next mount of the same bundle should not repeat it.
    ExpoLynxView.templateBundleCache.setObject(bundle, forKey: cacheKey)
  }
  guard let self, generation == self.loadGeneration, token == self.loadToken else { return }
  …
}
```

### 5.5 F16 — decouple viewport updates from the UIKit layout pass

`applyLayout` calls `updateViewport(…, needLayout: true)` synchronously inside `layoutSubviews`. With the default `.allOnUI` thread strategy this runs a full Lynx element-layout pass inside the UIKit layout pass. The `bounds.size != lastLayoutSize` guard is correct and does the heavy lifting, but during a *continuous* size change — rotation, keyboard, sheet detent drag — the size differs every frame, so a full relayout runs per frame.

Coalesce during transitions:

```swift
private var pendingViewportSize: CGSize?

private func scheduleViewportUpdate(_ size: CGSize) {
  lastLayoutSize = size
  let alreadyScheduled = pendingViewportSize != nil
  pendingViewportSize = size
  guard !alreadyScheduled else { return }
  DispatchQueue.main.async { [weak self] in
    guard let self, let size = self.pendingViewportSize else { return }
    self.pendingViewportSize = nil
    self.lynxView.updateViewport(
      withPreferredLayoutWidth: size.width,
      preferredLayoutHeight: size.height,
      needLayout: true
    )
  }
}
```

Keep the **synchronous** `applyLayout` for the first viewport (5.2 step 2) — the initial load must not be deferred. Only subsequent size changes go through the coalescing path.

### 5.6 F17 — seed safe-area insets instead of updating after load

`lastSafeAreaInsets` starts `nil`, so the `syncSafeAreaInsets()` call in `init` fires `updateGlobalProps` with all-zero insets before any template exists; the real insets then fire it again. Per the code's own comment each `updateGlobalProps` re-renders the page, so the second one lands right after first screen — a full re-render on the frame being measured.

- Do not call `syncSafeAreaInsets()` from `init`.
- In `loadTarget`, fold the current insets into the global props set **before** `loadTemplate` / `load`, and prime `lastSafeAreaInsets` with the value used.
- Let `layoutSubviews` / `safeAreaInsetsDidChange` handle only genuine post-load changes.

Also collapse the dual invocation: `safeAreaInsetsDidChange` is the authoritative callback; the `layoutSubviews` call exists to cover the pre-superview case, which the seeding above removes. Keep one path.

### 5.7 F18 — reveal on first screen, not on load start

`lynxView.isHidden = false` at `ExpoLynxView.swift:772` un-hides at load *start*, before the new content has painted. After a failed load hid the view, the next load therefore re-reveals the **stale** pixels until first screen — contradicting the intent stated in `finishWithError`'s comment. Move the un-hide into `handleFirstScreen`, immediately before `onLoad` is dispatched.

**Acceptance for Phase 5:** `LynxIFRLogger` first-screen timings improve on a cold managed load and a warm embedded load, measured over 10 runs each on a physical device, with no regression in `loadFinished`. `deliveryStorePrepared` no longer appears in the mount trace.

---

## 6. What this spec deliberately does not change

Recorded so a later reviewer does not "fix" them:

- **`addLifecycleClient` is not a retain cycle.** `LynxLifecycleDispatcher` stores clients in a weak `NSHashTable` (`LynxLifecycleDispatcher.m:18`).
- **The nested closure in `loadLocalURL` does not retain the view.** The inner `DispatchQueue.main.async` has no capture list but inherits the outer `[weak self]` capture's weak storage.
- **`NSCache` is thread-safe**, so `templateBundleCache` needs no additional locking.
- **The existing post-hop `loadGeneration` checks are correct** at `ExpoLynxView.swift:391`, `645`, `653`, `659`, `868`, `1212`, and in `startManagedDelivery`'s re-entry guard at `626`. Phase 1 and Phase 3 add the missing ones; they do not replace these.
- **`ExpoLynxSourcePayload`'s hand-rolled `JSONSerialization` parse** stays — the `Codable` witness-resolution cost it avoids is real.
- **`SWIFT_STRICT_CONCURRENCY = complete`** is out of scope; the Lynx ObjC surface is un-annotated and would produce unactionable noise.

---

## 7. Sequencing and risk

| Order | Phase | Blocking? | Risk if deferred |
| --- | --- | --- | --- |
| 1 | 0 — guardrails | No | Fixes land unverified. |
| 2 | 1 — thread discipline | **F1+F2+F3 must ship together** | Memory corruption, leaked native UI, possible continuation double-resume crash. |
| 3 | 2 — resource roots | Depends on 1.3 for teardown | Ships a timing-dependent resource-resolution regression. |
| 4 | 3 — delivery robustness | Depends on Phase 1's `assertMain` / generation guards | Silent error loss and a permanently hung JS promise. |
| 5 | 4 — warmer | Independent | Idle JSC VM retained for process lifetime. |
| 6 | 5 — performance | Depends on 1 and 2 being stable | The branch does not deliver its stated goal. |

Phase 5.2 carries the only real regression risk in the set, because it changes load/layout ordering. Land it last and behind the existing `LYNX_IFR_METRICS` instrumentation so a regression is visible in the numbers rather than only in a bug report.

---

## 8. Addendum — cloud review cross-check

An independent multi-agent review was run over the full 13-file branch diff. It did **not** receive the threading brief and did not read the vendored Lynx sources, so it and this document examined largely disjoint surfaces: it found no concurrency or lifecycle issues, and this document found nothing outside the three iOS files it was scoped to. Disposition of its five findings:

| Its finding | Severity | Disposition |
| --- | --- | --- |
| `prewarmRuntime()` throws on Android | normal | **New — F19 below.** Blocks §5.1. |
| Background-decoded bundle discarded on cancelled mount | nit | Duplicate of **F15**; already specified in §5.4. Independent confirmation, no change. |
| `templateCacheKey` whole-second mtime | nit | Partial disagreement; **§5.3 amended** below. |
| Docs `source` union lists `'download'`, never emitted | nit | **New — F20 below.** |
| Installation docs skip step 3 | nit | **New — F21 below.** |

### 8.1 F19 (normal) — `prewarmRuntime()` rejects on Android, and §5.1 depends on it

`packages/expo-lynx/src/ExpoLynxModule.ts:38` calls the native method unconditionally:

```ts
prewarmRuntime(): Promise<void> {
  return nativeModule.prewarmRuntime();
}
```

but `packages/expo-lynx/android/src/main/java/expo/modules/lynx/ExpoLynxModule.kt` registers only `checkForUpdate` and the view-scoped `reload` — there is no `prewarmRuntime`. On Android the call rejects with `nativeModule.prewarmRuntime is not a function`. The docstring three lines above the call already states the intended contract — *"No-op on platforms other than iOS"* — so this is an implementation gap, not a design question.

It ships as a guaranteed startup rejection for anyone following the installation docs, which instruct hosts to call it from `InteractionManager.runAfterInteractions` at launch.

**Fix** — capability check rather than a platform check, so it stays correct when Android gains the function:

```ts
prewarmRuntime(): Promise<void> {
  // Enforce the documented "no-op on platforms other than iOS" contract. The
  // Android module registers only `checkForUpdate` and the view-scoped
  // `reload`, so an unconditional call rejects with
  // "nativeModule.prewarmRuntime is not a function".
  if (typeof nativeModule.prewarmRuntime !== 'function') {
    return Promise.resolve();
  }
  return nativeModule.prewarmRuntime();
}
```

**Interaction with §5.1 — read before implementing that section.** §5.1 moves `LynxManagedDeploymentState.prepareStorage()` *into* `prewarmRuntime`, i.e. loads more onto this entry point. The iOS work itself is unaffected (the moved code is iOS-only), and §5.1's retained `init` calls remain an idempotent safety net, so the blast radius is bounded. But **F19 must land before or with §5.1**, otherwise the spec is directing more startup responsibility at an entry point that is broken on one platform.

**Acceptance:** calling `ExpoLynx.prewarmRuntime()` on Android resolves without throwing. Add a unit test asserting resolution when `nativeModule.prewarmRuntime` is absent.

### 8.2 Amendment to §5.3 — take the mtime at full precision

§5.3 records the whole-second mtime truncation in `templateCacheKey` as currently unreachable, on the grounds that dev rebuilds go through the remote-URL path rather than `loadLocalURL`, and managed releases land in unique per-release directories. That analysis stands for the product paths; the cloud review's counter-case (small fixtures, scripted repro) is a test-harness scenario.

The disagreement is moot, because §5.3 already replaces the `attributesOfItem` call with a `URLResourceValues` fetch on `templateDecodeQueue`. Take the date at full `Double` precision while doing so and the collision window closes at zero cost:

```swift
// Full sub-second precision: `Int(...)` truncation made the key collide across
// a same-second rebuild that happened to produce an identically-sized bundle.
let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
let size = values?.fileSize ?? 0
let mtime = values?.contentModificationDate?.timeIntervalSince1970 ?? 0
return "\(url.path)|\(size)|\(mtime)" as NSString
```

Supersedes the "add a comment rather than changing the key" instruction in §5.3. Drop that comment.

### 8.3 F20 (nit) — documented `source` union includes a value never emitted

`apps/docs/src/content/docs/reference/expo-lynx-view.mdx:64` (repeated at `:81` for `onError`) documents `source: 'embedded' | 'cache' | 'download' | 'development'`. No native path emits `'download'`: `ExpoLynxLoadTarget.source` is only ever assigned `"embedded"`, `"cache"`, or `"development"`. Consumers writing an exhaustive `switch` get a dead arm, and the union invites the same error in the shared TS payload type.

Remove `'download'` from both unions. If the shared TS types declare it, remove it there too and let the compiler find the dead branches.

### 8.4 F21 (nit) — installation step numbering

`apps/docs/src/content/docs/getting-started/installation.mdx` headings run 1, 2, 4, 5 — no step 3. Renumber.

---

## 9. Addendum — low-severity findings not tracked above

Recorded for completeness. None are worth their own phase; fold them into whichever phase touches the same code.

### 9.1 F22 (low) — a wrapped cancellation escapes the `deliveryTask` cancellation path

`ExpoLynxView.swift:657` catches cancellation by type:

```swift
} catch is CancellationError {
  return
} catch {
  … emitUpdateError / emitDeliveryError …
}
```

`LynxManagedDeliveryCoordinator.checkForUpdate` can surface a cancellation wrapped in a `LynxDeliveryError` (or as an `NSURLErrorCancelled` `URLError`), neither of which matches `is CancellationError`. Those fall to the general handler and emit a spurious `onUpdate`/`onError` for a load the caller deliberately cancelled — user-visible noise on fast navigation.

Broaden the check:

```swift
} catch {
  if error is CancellationError || Task.isCancelled { return }
  if (error as? URLError)?.code == .cancelled { return }
  guard generation == self.loadGeneration else { return }
  …
}
```

Fold into Phase 3.

### 9.2 F23 (low) — `LynxManagedViewRegistry` rebuilds its whole dictionary on every access

`LynxManagedViewRegistry.removeReleasedViews()` does `views = views.filter { … }`, allocating a fresh dictionary. It is called from `register` **and** from `matchingViews`, so every registration and every lookup is O(n) with an allocation. n is small (mounted Lynx views), so this is not a live problem — but `matchingViews` runs on the managed-delivery path, and the pruning is only actually needed when an entry has zeroed.

Prune lazily instead: drop `removeReleasedViews()` from `matchingViews` (the `compactMap(\.value)` already skips dead entries) and keep it only in `register`, or replace the whole structure with `NSHashTable.weakObjects()` and delete the `WeakView` box.

### 9.3 F24 (low) — `redactedEventMessage` is allocation-heavy on the error path

`ExpoLynxView.swift:1077-1093` splits the message, constructs a `URLComponents` per word, rebuilds each word, joins, then takes `.prefix(500).description`. For a long native error this is dozens of parser allocations, and the 500-char truncation happens *last* — after all the work.

Truncate first, and skip words that cannot be URLs:

```swift
let truncated = message.prefix(500)
let words = truncated.split(separator: " ", omittingEmptySubsequences: false).map { word -> String in
  guard word.contains("://") else { return String(word) }   // cheap pre-filter
  …existing redaction…
}
```

The `://` pre-filter is safe: `URLComponents` only yields a non-nil `scheme` *and* `host` — the existing guard — for strings containing it. Also replace `.description` on the `Substring` with `String(...)`.

Redaction correctness is unchanged; this is purely cost. Fold into Phase 5 if that file is already open.

### 9.4 F25 (low, **resolved — not a bug**) — `OnCreate`'s Lynx environment setup runs off-main, and that is safe

`ExpoLynxModule.OnCreate` calls `LynxEnv.sharedInstance()` and `lynxEnv.prepareConfig(...)`. The existing comment in `ExpoLynxView.init` asserts that "Expo's module `OnCreate` closure is nonisolated", which is the stated reason the MMKV warm-up was moved into the view initializer in the first place.

If `OnCreate` genuinely runs off the main thread, then Lynx environment initialisation — which touches process-global state and, depending on the SDK path, UIKit — is happening off-main at module registration. That would be a sibling of F1/F2 rather than a separate class of bug.

**This was not verified.** It requires establishing which thread Expo Modules Core invokes `OnCreate` on for this module type, and whether `LynxEnv.sharedInstance()` / `prepareConfig` have main-thread requirements in Lynx 4.0.0. Do that before acting; if `OnCreate` does run off-main, the fix is the same `onMain` trampoline introduced in §1.2, and §5.1's relocation of the MMKV warm-up should move there too rather than into `prewarmRuntime`.

**Resolved 2026-09-10 from source; no runtime measurement needed.** Both halves of the question are answerable from the vendored pod and from ExpoModulesCore, and the answer is that `OnCreate` may indeed run off-main but nothing it calls requires main.

Half 1 — *does it run off-main?* Yes, it can. `AppContext.registerNativeModules(provider:)` (`expo-modules-core/ios/Core/AppContext.swift:399`) calls `useModulesProvider(provider)` — which builds every `ModuleHolder`, and therefore fires every `OnCreate` — **before** its `if Thread.isMainThread { MainActor.assumeIsolated { … } } else { Task { @MainActor … } }` fork at `:403`. The fork's `else` branch is itself the proof: Expo would not have written it if registration were main-only.

Half 2 — *does that matter for this module's `OnCreate` body?* No. Both calls are thread-safe in Lynx 4.0.0:

| Call | Evidence | Verdict |
| --- | --- | --- |
| `LynxEnv.sharedInstance()` | `LynxEnv.mm:89-108` — `dispatch_once`, and the one main-thread-sensitive step (`prewarmTextIfNeeded`, which touches UIKit text) is **already** wrapped by the SDK in `dispatch_async(dispatch_get_main_queue(), …)` at `:99` | Safe off-main by design |
| `lynxEnv.prepareConfig(config)` | `LynxEnv.mm:389-397` — assigns `_config`, then `[_config.componentRegistry makeIntoGloabl]` → `LynxComponentRegistry.m:185-196` → `+registerUI:withName:` etc., whose backing stores are `LynxThreadSafeDictionary` (`:45-53`) | Safe off-main |

Lynx's authors hopped the one piece that needs main and left the rest thread-agnostic. **Do not add a main hop here.** A `DispatchQueue.main.sync` would risk the launch deadlock this section originally worried about, in exchange for nothing; an async hop would break the "shared environment before any other Lynx API" ordering. §5.1's placement of the MMKV warm-up in `prewarmRuntime` also stands — it was never contingent on this.

One residual, relevant only under Phase 0's sanitizer gate: `prepareConfig` writes the `_config` ivar without synchronisation. If TSan reports a race on it between module registration and a later `LynxEnv.config` read, this is the write it means. It is a one-shot publish that in practice happens long before any `LynxView` exists, and it is Lynx's code, not this module's — note it and move on rather than working around it.

---

## 10. Implementation log

### 2026-09-10 — Phase 0 + Phase 1 landed

**Phase 0 — guardrails**

- **0.1** `ExpoLynx.podspec` → `pod_target_xcconfig` gains `SWIFT_STRICT_CONCURRENCY = targeted`. Verified against `apps/expo-lynx-example` / `lynx-sandbox`: the compile runs `-swift-version 5 -strict-concurrency=targeted`, and on this toolchain (Swift 6.3) the "call to main actor-isolated … in a synchronous nonisolated context" violations are **hard errors**, not warnings — the spec's earlier "warnings" expectation was wrong. That is fine: 0.1 did its job, surfacing every real isolation break in the first Phase 1 attempt and forcing the shape below.
- **0.2** `assertMain(_:)` added to `ExpoLynxView` — `assert` in DEBUG, `@inline(__always)` no-op otherwise. Called at the top of every `handle*` method.
- **0.3** New `docs/ios-sanitizer-checklist.md` — TSan + Main Thread Checker gate for Phase 1.
- Fallout: `FastImage/AnimatedImage.swift` had to restate `@unchecked Sendable` (inherited from `SDAnimatedImage`) once `targeted` was on. One line, recorded in that vendored file's local-changes ledger.

**Phase 1 — thread discipline (F1, F2, F3)**

- **1.1** `LoadGenerationBox` (`NSLock`-boxed `Int`, `@unchecked Sendable`) added; `loadGeneration` mirrors into it via `didSet`. The only generation value safe to read off-main.
- **1.2** The three `LynxViewLifecycle` methods are thread-normalising trampolines: snapshot `generationBox.current`, then `onMain { … }`. Bodies moved verbatim into `handleLoadFinished(url:generation:)`, `handleFirstScreen(generation:)`, `handleError(_:generation:)`, each prefixed with `assertMain()` + `guard generation == loadGeneration else { return }`. `handleError` reads the stored `lynxView`, not the `view` parameter. `onMain` runs `work` synchronously when `Thread.isMainThread`, else `DispatchQueue.main.async`. The trampolines are **not** marked `nonisolated` — Lynx invokes them across the ObjC boundary where the compiler cannot see the isolation, and the runtime `Thread.isMainThread` check in `onMain` is the real guard. The F6 URL-equality check in `handleLoadFinished` is left as-is — Phase 3.
- **1.3** `deinit` cancels tasks, then **always** `DispatchQueue.main.async`s a teardown block (no sync-when-already-main fast path — it cannot be expressed from a nonisolated `deinit` without `MainActor.assumeIsolated`, iOS 17+): drains pending completions with `CancellationError`, calls `lynxView.clearForDestroy()` **on main**, so `[_templateRender.lynxUIRenderer reset]` actually runs and no `ECLynxThreadWrongThreadDestroyError` is dispatched. `self` is never captured; `removeLifecycleClient(self)` dropped (documented no-op — weak `NSHashTable`).
- **1.4 — deviated.** The spec's compile-time `@MainActor` typing of `forceReloadCompletion` / `deferredForceReload.completion` / the `completion:` params was implemented, then **reverted**: satisfying it from the nonisolated `deinit` needs `MainActor.assumeIsolated` (iOS 17+; pod floor is 16.4), and the `@MainActor`/non-`@MainActor` mix made the `deinit` completion array fail to type-check. Types are back to plain `(Result<Void, Error>) -> Void`. **F3 is still fixed in substance:** every call site of these completions is now provably on the main thread — `deinit` dispatches to the main queue; `completeCurrentLoadHealthIfReady`, `failCandidate`, `scheduleLoad`, `performForceReload` are all reached only on main (via the 1.2 trampolines or `@MainActor` methods). So `ReloadCompletion.complete` → `continuation.resume()` always runs on main and the `finished` latch is never raced → no double-resume. What is lost is the compiler *catching* a future off-main call site. Restore the annotation when the deployment target reaches iOS 17.

**Build verification:** `pod install` + `xcodebuild -scheme ExpoLynx` in `lynx-sandbox` (which symlinks this package). First attempt surfaced 5 isolation errors + the AnimatedImage warning — all now fixed. `swiftc -parse` of the edited files is clean.

### 2026-09-10 — Phase 2 landed (F4, F7)

- **2.2** New `packages/expo-lynx/ios/View/ExpoLynxResourceRoots.swift` — process-wide, lock-guarded (`@unchecked Sendable`), `static let shared`. `setRoot(_:owner:)` / `removeOwner(_:)` / `currentRoots() -> [URL]`, keyed by `ObjectIdentifier`, most-recent owner first, history depth 2 per owner. **Requires `pod install`** in any consuming app to enter `ExpoLynx.SwiftFileList`.
- **2.3** `ExpoLynxTemplateProvider`: `localResourceRoot` → `preferredResourceRoot` (per-view only). New `candidateRoots()` = preferred → `ExpoLynxResourceRoots.shared.currentRoots()` → `Bundle.main.resourceURL`. `bundledResourceURL(for:)` is now a `lazy.compactMap.first` over `candidateRoots()`; the `bundle://` / scheme / `..` handling is extracted verbatim into `normalizedComponents(_:)`. `currentLocalResourceRoot()` deleted (dead). Per-candidate sandboxing in `existingFileURL` / `existingResourceURL` is unchanged, so the widened root set cannot escape a registered root.
- **2.4** `loadTarget` computes `root` once, calls `templateProvider.setLocalResourceRoot(root)` **and** `ExpoLynxResourceRoots.shared.setRoot(root, owner: ObjectIdentifier(self))`. `deinit` calls `ExpoLynxResourceRoots.shared.removeOwner(ObjectIdentifier(self))` directly (lock-guarded, nonisolated — no main hop). `scheduleLoad` deliberately does **not** clear the registry — the next `loadTarget` overwrites, and history depth 2 is what keeps a superseded load's in-flight fetches resolving (F7).
- `ExpoLynxRuntimeWarmer.makeOptions()` unchanged: wiring the warm runtime to `ExpoLynxTemplateProvider.shared` is now correct because `.shared` resolves through the registry.

### 2026-09-10 — Phase 3 landed (F5, F6, F8)

- **3.1 F5** — `failCandidate` restructured: `assertMain()`, then the unconditional block (`watchdogWorkItem` cancel + nil, error emit/defer, `forceReloadCompletion` + `deferredForceReload.completion` resolved with `.failure`, `deliveryTask` cancel) runs **before** the `guard generation == loadGeneration`. The release-triple `guard let` is now a fallthrough: on a nil `managedRuntimeVersion` (reachable via `loadManagedRelease`'s `try?`) it loads the embedded bundle instead of silently returning. The old top guard dropped the error, leaked the watchdog, and hung `reloadMountedViews`' continuation.
  - **Deferred (deliberate):** the spec's "separately, tighten `loadManagedRelease` to resolve the runtime version once and treat failure as a delivery error." Routing that failure to `loadEmbedded` from inside `loadManagedRelease` strands `forceReloadCompletion` on the `performForceReload` path (embedded targets have `candidateManifestID == nil`, so `completeCurrentLoadHealthIfReady` never resolves it) — the same hang class as F5. The `failCandidate` restructure already makes a nil `managedRuntimeVersion` safe, so `try?` stays for now. Revisit with a completion-aware failure path.
- **3.2 F6** — new `ExpoLynxView.isSameTemplateURL(_:_:)`: exact match → file URLs compared on `standardizedFileURL.path` → remote compared on `absoluteString`. `handleLoadFinished` uses it, and on a same-generation mismatch it `assertionFailure`s (debug) but **proceeds** rather than `return`ing — a false negative here strands the gate until the 15s watchdog fails a healthy release, which is worse than a false positive.
- **3.3 F8** — new `loadToken = UUID()`, bumped in `loadTarget` alongside `currentLoadGate` / `currentTarget`. `loadLocalURL` takes `token: UUID`; both the cache fast path and the decode-queue main continuation now guard `token == loadToken` instead of `currentTarget?.url == target.url` (which passed for a same-URL forced reload, letting a superseded decode issue a second `lynxView.load`). `generation == loadGeneration` guards are kept — they catch cross-`scheduleLoad` staleness; the token catches within-generation `loadTarget` re-entry.

### 2026-09-10 — Phase 4 landed (F9)

- **4.1** `refillIfNeeded`'s `queue.async` block captures `self` **strongly** (was `[weak self]` + `guard let self else { return }`). `ExpoLynxRuntimeWarmer.shared` is a `static let` that never deallocates, so there is no cycle; the weak capture only encoded a permanent-wedge mode (a nil `self` would strand `building == true`).
  - **Deviation from spec:** the spec's 4.1 puts `building = false` in a `defer` and `warm = runtime` in a separate critical section. Those two lock acquisitions have a gap in which a concurrent `take()` can observe `warm == nil && building == true`, decline to refill, and then `defer` clears `building` — leaving the warmer permanently empty. Implemented instead as the original's single critical section (`warm` + `building` set together); `defer` is unnecessary because nothing between `building = true` and the assignment can throw or early-return once `self` is strong.
- **4.2** `ExpoLynxRuntimeWarmer` gains `private init()` that observes `UIApplication.didReceiveMemoryWarningNotification` and calls new `drain()` (`warm = nil`, no refill). `didEnterBackgroundNotification` draining is **not** added — a fast app-switch would drop the runtime and make the next foreground mount pay full JSC init; memory pressure is the unambiguous signal. `@unchecked Sendable` added to the class (lock-guarded) so the strong `self` capture and the observer closure are clean under `targeted`.
  - If `UIApplication` does not resolve transitively via `ExpoModulesCore` at full compile (it does for `UIEdgeInsets` in the same file), add `import UIKit`.

### 2026-09-10 — Phase 5 partial (F19, F10, F15, F18); F17 skipped by request

Landed the low-risk, high-confidence subset. The viewport/load-ordering trio (F11, F12, F16) and the stat/decode-queue items (F13, F14) are **deferred** to a focused follow-up — §7 flags F11/F12 as the only real regression risk in the set and says to land it last. **F17 (safe-area seeding) is skipped at the user's request.**

- **§8.1 F19** — `src/ExpoLynxModule.ts` `prewarmRuntime()` now guards `typeof nativeModule.prewarmRuntime !== 'function'` → `Promise.resolve()`. Capability check, not a `Platform` check. Prerequisite for §5.1.
- **§5.1 F10** — `ExpoLynxModule.swift` `AsyncFunction("prewarmRuntime")` now does `await MainActor.run { LynxManagedDeploymentState.prepareStorage(); _ = .shared }` before priming the warmer, moving `MMKV.initialize` + `createDirectory` + mmap off the first mount. `ExpoLynxView.init` keeps the same two calls as an idempotent safety net (`prepareStorage` guards on `didInitializeMMKV`, `.shared` is a lazy singleton).
- **§5.4 F15** — in `loadLocalURL`'s decode-queue main continuation, `templateBundleCache.setObject` is hoisted **above** `guard let self` (`if case .success … = outcome`). An unmount mid-decode no longer throws away the finished decode.
- **§5.7 F18** — `lynxView.isHidden = false` moved out of `loadTarget` (load start) into `handleFirstScreen` (first paint). A reload after a failed load no longer re-shows stale pixels. The `isHidden = true` failure paths in `loadTarget` / `finishWithError` / `handleError` are unchanged.

**Deferred (Phase 5 remainder):**
- **F11 + F12** — `scheduleLoad`'s `DispatchQueue.main.async` is accidentally load-bearing for viewport/load ordering; needs `hasViewport` gating + a deferred-load path before the hop can be removed. Highest regression risk; land last, behind `LYNX_IFR_METRICS`.
- **F13** (+ §8.2) — memoise embedded-feature path resolution; move `templateCacheKey` off main onto a `URLResourceValues` fetch on the decode queue at full `Double` mtime precision. Chicken-and-egg with the cache-hit fast path (needs the key before deciding to decode) — needs care.
- **F14** — build `LynxTemplateData(json:)` on `templateDecodeQueue`; the `initialDataNeedsUpdate = false` side effect of `consumeTemplateDataForLoad()` must stay on main.
- **F16** — coalesce `updateViewport(needLayout: true)` out of `layoutSubviews` during continuous size changes.

**F17 — safe-area forwarding removed by request.** Deleted `lastSafeAreaInsets`, `syncSafeAreaInsets()`, the `safeAreaInsetsDidChange()` override, and both call sites (`init`, `layoutSubviews`). Lynx pages no longer receive `safeAreaTop/Bottom/Left/Right` global props. This moots F17's double-render entirely. A re-add note is left in the code at the old `layoutSubviews` site: reinstate via `safeAreaInsetsDidChange` + `updateGlobalProps`, seeding the values into the initial `LynxTemplateData` before first load.

### 2026-09-10 — Phase 5 render trio (F11, F12, F14, F16); F13 still deferred

All four touch `ExpoLynxView.swift`. **Needs real-device `LYNX_IFR_METRICS` before/after** — §7 flags F11/F12 as the set's only real regression risk.

- New state: `hasViewport` (set in `applyLayout`), `pendingLoadTarget: (target, generation)?`, `pendingViewportSize: CGSize?`. `pendingLoadTarget` is cleared in `scheduleLoad`.
- **F12** — `loadTarget` gates at the top: if `!hasViewport`, either `applyLayout(bounds.size)` synchronously (bounds known) or stash `pendingLoadTarget` and `return` (bounds still zero). `layoutSubviews`, on a non-zero size, resumes the stashed load. Nothing above the gate mutates per-load state, so re-entry is clean. A forced reload never hits this (the view already has a viewport).
- **F11** — `scheduleLoad`'s trailing `DispatchQueue.main.async { … loadSource }` removed; `loadSource(generation:)` is called directly. `applyPendingUpdate` is already a batched main-thread callback; the viewport race the hop accidentally covered is now F12's job. `reload()` (which `AsyncFunction` may call off-main) wraps `scheduleLoad()` in `onMain { … }`.
- **F16** — `layoutSubviews` sends the **first** viewport through `applyLayout` (synchronous) and every later size change through new `scheduleViewportUpdate(_:)`, which coalesces to the next runloop turn (one Lynx relayout per resize gesture instead of one per frame). Trade-off: content lags the container by one frame during a continuous resize.
- **F14** — `loadLocalURL` snapshots `initialDataJSON` on main, builds `LynxTemplateData(json:)` on `templateDecodeQueue` alongside the bundle, and passes it through. The `initialDataNeedsUpdate = false` side effect stays on main, still only on the `.success` path. Assumes `LynxTemplateData(json:)` is safe to construct off-main (Lynx builds these on background threads for SSR/preset data) — **unverified**.

**Regression watch for this batch:**
- F12: a view that is mounted + has props but never gets a non-zero `layoutSubviews` will not start its load (and won't emit `onLoadStart`/`onLoad`). Previously it started against a zero viewport and rendered nothing useful anyway.
- F16: a layout reading the Lynx viewport synchronously right after a resize sees the previous size for one turn.
- F14: crash/corruption if `LynxTemplateData(json:)` is in fact main-thread-only.

**F13 still deferred** — memoise embedded-feature resolution + move `templateCacheKey` off main via `URLResourceValues` at full precision (§5.3 + §8.2). Chicken-and-egg with the cache-hit fast path (needs the key before deciding to decode); lowest value of the set.

### 2026-09-10 — low-priority backlog (F20–F24 done; F25 investigated)

- **F20** — `'download'` removed from the `source` union in `src/ExpoLynx.types.ts`, `src/LynxSource.ts`, and `apps/docs/.../reference/expo-lynx-view.mdx` (×2). The `'download'` *error stage* and `'downloaded'` *update phase* are untouched — both are emitted. `tsc --noEmit` clean.
- **F21** — `apps/docs/.../getting-started/installation.mdx` headings renumbered 1, 2, **3**, **4** (were 1, 2, 4, 5). No cross-references to the old numbers exist.
- **F22** — `deliveryTask`'s catch now also swallows `Task.isCancelled` and `URLError(.cancelled)`, not just `is CancellationError` — `checkForUpdate` can surface a wrapped/`URLError` cancellation that previously produced a spurious `onUpdate`/`onError` on fast navigation.
- **F23** — `LynxManagedViewRegistry.matchingViews` no longer calls `removeReleasedViews()` (an O(n) dict rebuild on every managed-delivery lookup); `compactMap(\.value)` already skips zeroed weak entries. Pruning stays in `register`.
- **F24** — `redactedEventMessage` truncates to 500 chars *first*, then skips any word without `://` before the `URLComponents` parse. Redaction output is unchanged; the per-word parser allocations on a long native error are gone.

- **F25 — investigated, not fixed.** ExpoModulesCore's own `registerNativeModules(provider:)` (`AppContext.swift:399`) has an explicit `if Thread.isMainThread { … } else { Task { @MainActor … } }` fork, i.e. **Expo does not guarantee module registration runs on main**, and `OnCreate` fires from `ModuleHolder.init` (`ModuleHolder.swift:56`) *before* that fork. So `ExpoLynxModule.OnCreate` — `LynxEnv.sharedInstance()` + `prepareConfig(...)` — can run off the main thread, and Lynx env init plausibly touches `UIScreen`/UIKit. **Not patched:** the safe fix is a synchronous main hop, but `DispatchQueue.main.sync` from the module-registration thread risks a launch deadlock, and "Lynx requires the shared environment before any other Lynx API" rules out an async hop. Needs an empirical thread check in the running app (add a `Thread.isMainThread` log to `OnCreate`) before choosing between: (a) documenting that hosts must trigger registration on main, or (b) a `JavaScriptActor`/launch-safe hop. Assign with Phase 1's thread-contract context.

### 2026-09-10 — F13 + F5-tail

- **F13 Part 1** — `loadEmbedded` memoises `feature → embeddedName` in a lock-guarded static `[String: String]`. Embedded assets are immutable within a process, so the two `resolveLocalURL` probes (v2 path, then `<feature>.lynx`) now run once per feature instead of on every mount / fallback.
- **F13 Part 2** — `templateCacheKey` replaced `FileManager.attributesOfItem` with `url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])`, keeps mtime at full `Double` precision (§8.2), and memoises `path → NSString` in a lock-guarded static dict. The first load of a path pays the stat; every repeat mount is stat-free. Kept on main (not moved to `templateDecodeQueue`) deliberately — the cache-hit fast path needs the key *before* deciding whether to decode, and the memo removes the repeat cost anyway.
  - **Still not done in F13:** the third `resolveLocalURL(target.url)` inside `loadTarget`. It resolves against `ExpoLynxResourceRoots` (F7), whose root set is dynamic, so a `value → URL` memo there could return a stale root. Left as-is.
- **F5-tail** — `loadManagedRelease` now resolves `LynxManagedDeliveryConfiguration.runtimeVersion()` with a real `do/catch` instead of `try?`. On failure it routes through `failCandidate` (whose unconditional block resolves any pending force-reload completion and clears the watchdog) with `managedRuntimeVersion: nil`, so the nil-triple branch falls back to the embedded bundle. This is the completion-aware failure path the earlier deferral was waiting on; no force-reload hang.

**Not yet done:** the `LYNX_IFR_METRICS` before/after for the F11/F12/F14/F16 batch; fixture tests; the sanitizer runs; restore 1.4's `@MainActor` typing at iOS 17. **All code findings F1–F24 are now implemented** (F17 removed by request). F25 is closed as not-a-bug — see the resolution in §9.4.

---

## 11. Post-implementation review (2026-09-10)

Read against the landed code at `42dd8e4`, not against the spec text. Verdict on the three deviations flagged at hand-off, then two findings the implementation introduced.

### 11.1 Deviations — all three accepted

**F3 (`@MainActor` typing reverted, runtime discipline kept).** Verified. Every site that invokes `forceReloadCompletion` or `deferredForceReload.completion` is provably main-thread:

| Site | Why it is on main |
| --- | --- |
| `scheduleLoad` | reached from `applyPendingUpdate` (Expo's batched main-thread props callback) or from `reload()`, which goes through `onMain` |
| `performForceReload` | called from `forceReloadManagedRelease`, whose only caller is the `@MainActor` `LynxManagedViewRegistry`, or from `completeCurrentLoadHealthIfReady` below |
| `completeCurrentLoadHealthIfReady` | reached only from `handleLoadFinished` / `handleFirstScreen`, both post-`onMain` and both opening with `assertMain()` |
| `failCandidate` | opens with `assertMain()`; its five callers are all inside post-`onMain` bodies or the main-queue watchdog |
| `deinit` | explicitly drains both completions inside `DispatchQueue.main.async` |

The compile-time annotation would have been strictly better, and the `MainActor.assumeIsolated` / iOS 17 reasoning for dropping it is correct against the 16.4 floor. The in-code comment already carries the restore instruction. Nothing further to do.

**F9 (single critical section instead of the spec's `defer`).** The implementation is right and the spec was wrong. `defer { building = false }` around an early `return` splits the `warm` and `building` writes across two lock acquisitions, opening a window where a concurrent `take()` observes `warm == nil && !building` with no refill pending — the warmer then never refills. Since `makeOptions()` and `LynxBackgroundRuntime.init` cannot throw, there is no bail path between the guard and the assignment, so the single critical section is sound. The strong `self` capture is also correct: `shared` is a `static let`, so there is no cycle, and the previous `[weak self]` was the thing that could strand `building == true`.

**F13 (memoised cache key).** The memo's correctness rests on `(size, mtime)` never changing for a given path within one process. Verified: managed releases resolve to `<root>/<feature>/ready/<runtimeKey>/<releaseID>/main.lynx.bundle` (`LynxManagedBundleStore.swift:62-67`, `:315-327`), so a new release is a new `releaseID` directory and therefore a new path — an updated bundle can never reuse a memoised key. Embedded assets are immutable; dev bundles take the remote-URL path. The premise holds.

### 11.2 F26 (nit) — `drain()` does not fence an in-flight build

`ExpoLynxRuntimeWarmer.drain()` clears `warm` but leaves `building` alone, and the queued build block assigns `self.warm = runtime` unconditionally. Because `refillIfNeeded` only dispatches when `warm == nil`, a drain that lands mid-build has nothing to clear and the build then completes — allocating a fresh JSC VM immediately after the memory warning that was supposed to release one. Cost is bounded at one runtime, so this is a nit, not a leak.

Fix, if taken: an epoch counter bumped under the lock in `drain()` and captured by the build block, which assigns only when the epoch still matches.

```swift
private var epoch = 0

func drain() {
  lock.lock()
  warm = nil
  epoch &+= 1   // invalidate any build already in flight
  lock.unlock()
}
```

…with the build block capturing `let builtFor = epoch` inside the existing critical section and guarding `guard builtFor == self.epoch else { return }` before `self.warm = runtime` (still clearing `building` either way).

### 11.3 F27 (normal) — F12's viewport gate has no escape hatch

`loadTarget` stashes into `pendingLoadTarget` when the view has no viewport, and the *only* place that stash is drained is `layoutSubviews` (plus `scheduleLoad`, which discards it). A view that never receives non-zero bounds — a collapsed flex parent, a zero-height container, a host that mounts the view before giving it a size and never re-lays-out — therefore never loads, and because `onLoadStart(…)` sits *below* the gate, it emits **nothing at all**: no `onLoadStart`, no `onError`, no timeout. JS awaiting `onLoad` hangs forever with no diagnostic.

This is a behavioural regression against the pre-F12 code, which loaded at a zero viewport — a wasted layout pass, but observable, and it still fired the load events. F12 traded a visible perf problem for a silent one.

The fix should preserve F12's intent (never lay out Lynx against a placeholder viewport) while making the stalled state observable. In rough order of preference:

1. Emit `onLoadStart` when the target is stashed rather than after the gate, so the JS side sees the load begin, and keep the Lynx call gated. This restores event parity at zero cost.
2. Add a debug-only diagnostic — an `assertionFailure` or a one-shot log — when a target has been stashed across more than one layout pass while the view is in a window.
3. Optionally, a bounded fallback: if the view is in a window and still zero-sized after a short deadline, proceed with the load rather than stalling indefinitely.

Do **not** simply remove the gate; the F11/F12 pairing is what removes the duplicate first layout pass.

---

## 12. Proposal — fix F26 and F27

Two independent changes, both small, both confined to `packages/expo-lynx/ios/View/ExpoLynxView.swift`. They share no state and can land in either order or in one commit. Neither touches the Lynx callback boundary, so Phase 1's thread contract is unaffected.

**Recommended commit split:** one commit, `fix(ios): bound the F12 viewport gate; fence warmer drain against an in-flight build`. They are each too small to justify their own commit and both fall out of the same review pass.

### 12.1 F27 — bound the viewport gate with a deadline

#### Design

§11.3 offered three options and listed "move `onLoadStart` above the gate" first. **Withdraw that one.** It creates a double-emit hazard: the stashed target is re-entered through `loadTarget` when layout arrives, so the announce would fire twice for one load unless the stash carries an extra `didAnnounce` flag. Adding a flag to suppress a duplicate of an event we only moved in order to be visible is the wrong shape.

Take a single mechanism instead: **a deadline on the stash**. If a stashed load is still stashed after 1 second, proceed at Lynx's default viewport. This subsumes both remaining options — the load becomes observable because it actually happens (`onLoadStart`, then the normal success or failure path), and the stall is bounded without a second event mechanism.

Three properties make this the right fallback rather than, say, emitting an error:

1. **It restores the pre-F12 behaviour exactly, and only in the pathological case.** Before F12, a zero-bounds view loaded against Lynx's default viewport because `layoutSubviews`' `bounds.size != lastLayoutSize` guard meant `applyLayout` never ran at all. The fallback must therefore *not* call `applyLayout(.zero)` — it leaves `hasViewport == false` so the first real `layoutSubviews` still performs the initial viewport sync normally.
2. **It self-corrects.** A view that gets a size later (a tab that activates, a container that expands) hits `layoutSubviews` → `hasViewport == false` → `applyLayout`, and Lynx relayouts against the real viewport. The cost is the duplicate layout pass F11/F12 exist to avoid — paid only by a view that sat sizeless for a second.
3. **It cannot fire on the fast path.** `init` already calls `applyLayout` when bounds are non-zero at construction, and a normally-mounted view reaches `layoutSubviews` in the same runloop turn. The deadline is dead code in every healthy mount.

1 second is chosen to be far beyond any legitimate layout latency while still well inside a user's patience for a screen that will otherwise render nothing.

#### Diff

New stored properties, beside the existing `pendingLoadTarget` declaration:

```swift
  private var pendingLoadTarget: (target: ExpoLynxLoadTarget, generation: Int)?
  // F27: the viewport gate must not be able to stall a load indefinitely. A
  // view that never receives non-zero bounds — a collapsed flex parent, a
  // container that is mounted but never sized — would otherwise sit in
  // `pendingLoadTarget` forever and emit nothing at all: no `onLoadStart`, no
  // `onError`, no timeout. After this deadline the load proceeds against
  // Lynx's default viewport, which is exactly what happened before F12.
  private var pendingLoadDeadline: DispatchWorkItem?
  private var viewportGateWaived = false
  private static let viewportGateTimeout: TimeInterval = 1
```

Replace the gate in `loadTarget`:

```swift
    if !hasViewport {
      if bounds.size.width > 0, bounds.size.height > 0 {
        applyLayout(bounds.size)
      } else if !viewportGateWaived {
        stashPendingLoad(target, generation: generation)
        return
      }
      // Waived by the deadline: fall through and load at Lynx's default
      // viewport. `applyLayout` is deliberately NOT called with the zero size —
      // `hasViewport` stays false so the first real `layoutSubviews` still
      // performs the initial viewport sync.
    }
```

New helper, next to `loadTarget`:

```swift
  /// Park a load until a real viewport arrives, with a deadline so it cannot
  /// stall forever (F27).
  private func stashPendingLoad(_ target: ExpoLynxLoadTarget, generation: Int) {
    assertMain()
    pendingLoadTarget = (target, generation)
    guard pendingLoadDeadline == nil else { return }

    let deadline = DispatchWorkItem { [weak self] in
      guard let self else { return }
      self.pendingLoadDeadline = nil
      guard let pending = self.pendingLoadTarget else { return }
      self.pendingLoadTarget = nil
      self.viewportGateWaived = true
      // Amended during implementation: `NSLog`, not `assertionFailure`. See
      // the note under the diff.
      NSLog(
        """
        [expo-lynx] View still had zero bounds %.0fs after a load was requested; \
        loading against Lynx's default viewport. Give the view an explicit size \
        — it will otherwise pay a duplicate layout pass when a real size arrives.
        """,
        Self.viewportGateTimeout
      )
      self.loadTarget(pending.target, generation: pending.generation)
    }
    pendingLoadDeadline = deadline
    DispatchQueue.main.asyncAfter(
      deadline: .now() + Self.viewportGateTimeout,
      execute: deadline
    )
  }
```

Cancel the deadline at the two points that already clear `pendingLoadTarget`, plus `deinit`:

```swift
  // in layoutSubviews, in the existing resume block, immediately after
  //   pendingLoadTarget = nil
  pendingLoadDeadline?.cancel()
  pendingLoadDeadline = nil

  // in scheduleLoad, beside the existing `pendingLoadTarget = nil`
  pendingLoadDeadline?.cancel()
  pendingLoadDeadline = nil
  viewportGateWaived = false

  // in deinit, beside the existing deliveryTask / watchdogWorkItem cancels
  pendingLoadDeadline?.cancel()
```

`viewportGateWaived` resets in `scheduleLoad` and nowhere else: the waiver applies to the load that stalled, and every subsequent load re-enters the gate from a clean state.

**Amended during implementation.** The proposal originally used a debug-only `assertionFailure` here. That is wrong for this path: a view can legitimately sit at zero bounds for a second — a collapsed bottom sheet, an inactive tab, a container mid-animation — so trapping the debug build would punish a real layout for being slow rather than for being wrong, and it is a false positive the host cannot always fix. The recovery is already correct; the diagnostic should inform, not halt. `NSLog` with the `[expo-lynx]` prefix matches the convention already used in `ImageUtils.swift` / `ImageCacheType.swift` for exactly this "unusual but handled" case, and it ships in release too, where the stall is just as worth knowing about. `assertionFailure` stays reserved for genuine invariant violations, as in the F6 URL-mismatch check.

### 12.2 F26 — fence `drain()` against an in-flight build

#### Design

The constraint carried over from the F9 correction: **do not split the `warm` / `building` writes across two lock acquisitions.** Whatever fences the build must live inside the same single critical section that already closes the block.

An epoch counter does that. `drain()` bumps it under the lock; the build captures its value at dispatch time and, in the closing critical section, assigns `warm` only if the epoch still matches. `building = false` stays unconditional, so the invariant a concurrent `take()` relies on — never `warm == nil && !building` with a refill pending — is preserved on both branches.

A discarded runtime is simply released when the closure returns. The next `take()` finds `warm == nil, !building` and refills normally, which is correct: `drain()`'s contract is "release and do not refill *from here*", not "stay empty".

#### Diff

```swift
  private var building = false
  /// Bumped by `drain()` so a build already in flight can tell that its result
  /// is no longer wanted (F26). Without it a memory warning that lands
  /// mid-build completes anyway, allocating a fresh JSC VM immediately after
  /// the warning that was supposed to release one.
  private var epoch = 0
```

```swift
  func drain() {
    lock.lock()
    warm = nil
    epoch &+= 1
    lock.unlock()
  }
```

```swift
  private func refillIfNeeded() {
    lock.lock()
    guard warm == nil, !building else {
      lock.unlock()
      return
    }
    building = true
    let builtFor = epoch
    lock.unlock()

    // … existing comment on the strong `self` capture stays as-is …
    queue.async {
      let options = self.makeOptions()
      #if DEBUG
        let runtime = LynxBackgroundRuntime(options: options, debuggable: true)
      #else
        let runtime = LynxBackgroundRuntime(options: options)
      #endif
      self.lock.lock()
      // `building` clears unconditionally — a concurrent `take()` must never
      // observe `warm == nil && !building` with a refill still pending. The
      // runtime itself is kept only if no `drain()` intervened; otherwise it is
      // released here and the next `take()` refills.
      self.building = false
      if builtFor == self.epoch {
        self.warm = runtime
      }
      self.lock.unlock()
    }
  }
```

`&+=` rather than `+=`: the counter is monotonic for the process lifetime and wrapping is harmless (a collision needs 2⁶⁴ drains between one build's dispatch and its completion), but an overflow trap in a release-path lock would not be.

### 12.3 Verification

Neither fix is covered by the existing fixture tests, and both live on paths that are hard to reach from a normal mount — which is the same reason they survived review until now.

| Check | How |
| --- | --- |
| F27 fallback fires | Mount `ExpoLynxView` inside a zero-height container in `apps/lynx-example`. Before: no events at all. After: `onLoadStart` within ~1s, then the normal load result, plus the debug assertion. |
| F27 self-correction | Same view, then give the container a real height. Expect one `applyLayout` → `updateViewport` and a correct render, not a stalled view. |
| F27 fast path untouched | Normal mount with `LYNX_IFR_METRICS` on: `sourceSelected` → `loadFinished` → `firstScreen` timings unchanged, and the deadline must never fire. This doubles as the F11/F12 before/after that §10 still lists as outstanding. |
| F26 fence | Call `prewarmRuntime`, then trigger *Debug → Simulate Memory Warning* while the build is in flight (a breakpoint on the `queue.async` body makes the window reachable). Expect the built runtime to be discarded, `warm == nil`, and the next mount to take the stock path. |
| No regression in warmer liveness | After the drain above, call `prewarmRuntime` again and confirm a warm runtime is produced — i.e. the epoch fence did not wedge the warmer, which is the failure mode the F9 correction was guarding against. |

Both changes are main-thread-only or lock-guarded, so they add nothing new for TSan to see; the sanitizer runs still outstanding from Phase 0 cover them incidentally.

### 12.4 Risk

| | F27 | F26 |
| --- | --- | --- |
| Blast radius | `loadTarget` gate + `layoutSubviews` resume | `ExpoLynxRuntimeWarmer` only |
| Worst case if wrong | A healthy view loads 1s late at a default viewport — visible, recoverable, and loud in debug | The warmer stays empty; every mount takes the stock path, which is the pre-optimisation behaviour |
| Reversibility | Delete the deadline and the waiver; the gate returns to its current form | Delete the epoch; `drain()` returns to its current form |

Neither can produce a state worse than the code that preceded the phase it belongs to, which is the property that makes them safe to land together.

---

### 2026-09-10 — F26 + F27 landed (§12)

Implemented as proposed in §12, with one deliberate deviation.

- **F27** — `loadTarget`'s viewport gate now stashes through `stashPendingLoad`, which arms a 1s `pendingLoadDeadline`. On expiry the load proceeds with `viewportGateWaived = true`, falling through the gate without calling `applyLayout`, so `hasViewport` stays false and the first real `layoutSubviews` still performs the initial viewport sync. The deadline is cancelled at all three points that already clear `pendingLoadTarget` (`layoutSubviews` resume, `scheduleLoad`, `deinit`); `scheduleLoad` also resets the waiver so every subsequent load re-enters the gate clean.
  - **Deviation:** the debug-only `assertionFailure` became an unconditional `NSLog`. Reasoning recorded inline in §12.1.
- **F26** — `drain()` bumps an `epoch` under the lock; `refillIfNeeded` captures it at dispatch and assigns `warm` only on a match. `building = false` stays unconditional, preserving the invariant the F9 correction established — a concurrent `take()` can never observe `warm == nil && !building` with a refill pending.

Verified `swiftc -parse` clean. **Not yet run:** the §12.3 device checks — the zero-height container repro, the mid-build memory warning, and the re-prime-after-drain liveness check that guards against re-introducing the F9 wedge.
