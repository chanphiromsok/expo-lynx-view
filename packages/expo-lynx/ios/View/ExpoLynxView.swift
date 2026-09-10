import ExpoModulesCore
import Lynx


/// Keeps one `LynxBackgroundRuntime` warmed ahead of the next `ExpoLynxView`
/// mount. Creating the runtime spins up the background JS engine and evaluates
/// `lynx_core.js`; doing that ahead of time takes the JSC init + framework eval
/// off the `Lynx_JS` thread at mount, where it otherwise contends with the main
/// thread's first render. The runtime is consumed when a view attaches to it,
/// so a replacement is rebuilt in the background after every `take()`.
///
/// `prime()` is exposed as the `prewarmRuntime` module function rather than run
/// from `OnCreate`, so the host app controls the timing (call it once the first
/// screen is interactive) and the JSC init never competes with app launch. The
/// build runs on a `.utility` queue so the scheduler yields it under load.
final class ExpoLynxRuntimeWarmer: @unchecked Sendable {
  static let shared = ExpoLynxRuntimeWarmer()

  private let lock = NSLock()
  private var warm: LynxBackgroundRuntime?
  private var building = false
  private let queue = DispatchQueue(
    label: "com.expo.lynx.runtime-warmer",
    qos: .utility
  )

  private init() {
    // A warm runtime is a live JSC VM with lynx_core.js evaluated. If the last
    // ExpoLynxView unmounts, it would otherwise sit idle for the rest of the
    // process. Drop it under memory pressure; the host re-primes via
    // `prewarmRuntime` when it next wants the optimisation. Never refill from
    // here.
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

  private func makeOptions() -> LynxBackgroundRuntimeOptions {
    let options = LynxBackgroundRuntimeOptions()
    // Default engine is JSC, matching the per-view builder. The resource
    // fetchers are `nonnull`; reuse the shared provider that is also installed
    // on `LynxEnv` in `ExpoLynxModule.OnCreate`, so lazy bundles / external JS
    // requested by the background runtime resolve the same way.
    let provider = ExpoLynxTemplateProvider.shared
    options.templateResourceFetcher = provider
    options.genericResourceFetcher = provider
    options.mediaResourceFetcher = provider
    // Evaluate lynx_core.js during this prewarm, not at mount.
    options.pendingCoreJsLoad = false
    return options
  }

  /// Build the first warm runtime. Safe to call more than once.
  func prime() {
    refillIfNeeded()
  }

  /// Hand the warm runtime to a mounting view (consumed on attach) and schedule
  /// a replacement. Returns nil when none is ready yet — the caller then starts
  /// its own runtime, exactly as before this optimisation.
  func take() -> LynxBackgroundRuntime? {
    lock.lock()
    let runtime = warm
    warm = nil
    lock.unlock()
    refillIfNeeded()
    return runtime
  }

  private func refillIfNeeded() {
    lock.lock()
    guard warm == nil, !building else {
      lock.unlock()
      return
    }
    building = true
    lock.unlock()

    // Capture `self` strongly: `shared` is a `static let` that never
    // deallocates, so there is no cycle to break, and a `[weak self]` that
    // ever resolved to nil (as the previous code allowed) would strand
    // `building == true` forever — the warmer would never refill again.
    // `makeOptions()` and `LynxBackgroundRuntime.init` do not throw, so there
    // is no path between here and the assignment that can bail; `warm` and
    // `building` are still set in one critical section so a concurrent `take()`
    // cannot observe `warm == nil && !building` with no refill pending.
    queue.async {
      let options = self.makeOptions()
      #if DEBUG
        let runtime = LynxBackgroundRuntime(options: options, debuggable: true)
      #else
        let runtime = LynxBackgroundRuntime(options: options)
      #endif
      self.lock.lock()
      self.warm = runtime
      self.building = false
      self.lock.unlock()
    }
  }
}


private struct ExpoLynxSourcePayload: Decodable {
  let kind: String
  let feature: String?
  let url: String?

  // Hand-rolled parse of the small `{kind, feature?, url?}` object. Avoids the
  // generic `JSONDecoder` / `Codable` path, whose one-time Swift-runtime witness
  // resolution (swift_conformsToProtocol / _checkGenericRequirements) is a few
  // ms of main-thread work on the first load.
  init?(jsonString: String) {
    guard
      let object = try? JSONSerialization.jsonObject(with: Data(jsonString.utf8)),
      let dict = object as? [String: Any],
      let kind = dict["kind"] as? String
    else {
      return nil
    }
    self.kind = kind
    self.feature = dict["feature"] as? String
    self.url = dict["url"] as? String
  }
}

private struct ExpoLynxLoadTarget {
  let url: String
  let feature: String
  let version: String
  let source: String
  let managedFeature: String?
  let managedRuntimeVersion: String?
  let candidateManifestID: String?
}

private struct LynxInitialLoadGate {
  private(set) var hasFirstScreen = false
  private(set) var hasFinishedLoading = false
  private var consumed = false

  var isReady: Bool { hasFirstScreen && hasFinishedLoading }

  mutating func recordFirstScreen() -> Bool {
    guard !hasFirstScreen else { return false }
    hasFirstScreen = true
    return true
  }

  mutating func recordLoadFinished() {
    hasFinishedLoading = true
  }

  mutating func consumeReady() -> Bool {
    guard isReady, !consumed else { return false }
    consumed = true
    return true
  }
}

/// `loadGeneration` is only mutated on the main actor, but Lynx delivers
/// `didLoadFinishedWithUrl:` and `didRecieveError:` on its own threads
/// (LynxView.mm:1145, :838). Those trampolines must read the generation
/// *before* hopping to main, so a stale callback from load N is dropped rather
/// than applied to load N+1. This lock-boxed mirror is the only generation
/// value safe to read off the main thread.
private final class LoadGenerationBox: @unchecked Sendable {
  private let lock = NSLock()
  private var value = 0

  func set(_ newValue: Int) {
    lock.lock()
    value = newValue
    lock.unlock()
  }

  var current: Int {
    lock.lock()
    defer { lock.unlock() }
    return value
  }
}

final class ExpoLynxView: ExpoView, LynxViewLifecycle {
  let onLoadStart = EventDispatcher()
  let onLoad = EventDispatcher()
  let onError = EventDispatcher()
  let onUpdate = EventDispatcher()

  private let lynxView: LynxView
  private let templateProvider: ExpoLynxTemplateProvider
  private var legacySource: String?
  private var sourceJSON: String?
  private var initialDataJSON: String?
  private let generationBox = LoadGenerationBox()
  private var loadGeneration = 0 {
    didSet { generationBox.set(loadGeneration) }
  }
  private var hasLoadedTemplate = false
  private var lastLayoutSize = CGSize.zero
  // F11/F12: a load must not start before the real viewport is known, or Lynx
  // lays out against a zero/default size and repeats the pass when the real
  // size arrives. `hasViewport` flips true on the first `applyLayout`; a load
  // that arrives first is stashed here and driven from `layoutSubviews`.
  private var hasViewport = false
  private var pendingLoadTarget: (target: ExpoLynxLoadTarget, generation: Int)?
  // F16: coalesce viewport updates during a continuous resize (rotation,
  // keyboard, sheet-detent drag) into one Lynx relayout on the next turn.
  private var pendingViewportSize: CGSize?
  private var sourceNeedsReload = false
  private var initialDataNeedsUpdate = false
  private var currentTarget: ExpoLynxLoadTarget?
  // Retain only the validated declarative source configuration. This is the
  // authority for an explicit JS update check; JS never supplies a URL to the
  // imperative method.
  private var managedFeature: String?
  private var deliveryTask: Task<Void, Never>?
  private var watchdogWorkItem: DispatchWorkItem?
  // F3: the terminal consumer is `LynxManagedViewRegistry`'s `@MainActor`
  // `ReloadCompletion`, which resumes a `CheckedContinuation` — a double-resume
  // is a hard crash. Compile-time `@MainActor` typing on this closure was
  // tried, but satisfying it from the nonisolated `deinit` needs
  // `MainActor.assumeIsolated`, which is iOS 17+ (deployment target is 16.4).
  // Instead `deinit` drains these on the main queue, so the resume is always
  // main-thread — the substance of the fix. Restore the annotation when the
  // deployment target reaches iOS 17.
  private var forceReloadCompletion: ((Result<Void, Error>) -> Void)?
  private var deferredForceReload:
    (
      release: LynxManagedRelease,
      completion: (Result<Void, Error>) -> Void
    )?
  private var deferredDeliveryError:
    (
      error: Error,
      fallbackURL: String,
      feature: String
    )?
  private var currentLoadGate = LynxInitialLoadGate()
  // Bumped on every `loadTarget`, including a same-URL forced reload that does
  // not advance `loadGeneration`. A `templateDecodeQueue` callback from a
  // superseded `loadTarget` captures the old token and drops out here, where
  // the `currentTarget?.url == target.url` check used to let it through (F8).
  private var loadToken = UUID()
  private var managedDeliveryStartedGeneration: Int?
  private var loadStartedAt = Date()
  #if DEBUG || LYNX_IFR_METRICS
    private var sourceSelectionStartedAt: Date?
  #endif

  var mountedManagedFeature: String? { managedFeature }

  required init(appContext: AppContext? = nil) {
    #if DEBUG || LYNX_IFR_METRICS
      let deliveryStorePreparationStartedAt = Date()
    #endif
    // Do not set screen metrics here. Lynx 4 marks screen-metric updates as
    // experimental and does not support multiple views with different metrics.
    // The per-view viewport is updated from this view's bounds in applyLayout.
    let provider = ExpoLynxTemplateProvider()
    templateProvider = provider
    lynxView = LynxView { builder in
      // Match Lynx Explorer: each view gets a config backed by the provider
      // prepared on LynxEnv, while the fetcher handles remote URL reloads.
      builder.config = LynxConfig(provider: provider)
      // Register the SDWebImage-backed <x-lynx-fast-image> element (ios/FastImage/).
      // Runtime lookup so ExpoLynx still compiles if the sources are stripped.
      if let fastImageElement = NSClassFromString("LynxFastImageElement") {
        builder.config?.registerUI(fastImageElement, withName: "x-lynx-fast-image")
      }
      // Match Lynx Explorer: native URL reloads and lazy bundles use the
      // resource-fetcher pipeline when one is supplied by the host.
      builder.templateResourceFetcher = provider
      // Keep the resource pipeline enabled in Release as well. Static Lynx
      // bundles can reference sidecar scripts, fonts, and images that live in
      // the application bundle.
      builder.enableGenericResourceFetcher = .true
      builder.genericResourceFetcher = provider
      builder.mediaResourceFetcher = provider
      #if DEBUG
        // Rspeedy HMR downloads main.<hash>.hot-update.json as ExternalJS,
        // which Lynx routes through LynxGenericResourceFetcher rather than the
        // template fetcher. Explorer explicitly enables the same path.
        builder.debuggable = true
      #endif
      builder.fontScale = 1
      // Attach to a background JS runtime whose engine + lynx_core.js were
      // evaluated ahead of time (ExpoLynxRuntimeWarmer, primed via the
      // `prewarmRuntime` module function). Otherwise the LynxView spins up JSC
      // and evaluates lynx_core.js on the Lynx_JS thread at mount, contending
      // with the main thread's first render. nil falls back to the stock path.
      if let warmRuntime = ExpoLynxRuntimeWarmer.shared.take() {
        builder.lynxBackgroundRuntime = warmRuntime
      }
      // NOTE: `builder.setThreadStrategyForRender(.mostOnTASM)` moves element
      // build + layout + text measure off the UI thread and shaves a further
      // ~50-90ms, but runs custom UI elements' measure/shadow-node code on
      // Lynx's layout thread — only safe once every registered element is known
      // thread-safe. Left on the default (.allOnUI); revisit as an opt-in.
    }

    super.init(appContext: appContext)

    // Expo's module OnCreate closure is nonisolated. UIKit view construction
    // is main-actor isolated and happens before source selection, so warm the
    // single-process delivery store here instead.
    LynxManagedDeploymentState.prepareStorage()
    _ = LynxManagedDeploymentState.shared
    #if DEBUG || LYNX_IFR_METRICS
      let deliveryStorePreparationMilliseconds = max(
        0,
        Int(Date().timeIntervalSince(deliveryStorePreparationStartedAt) * 1_000)
      )
      LynxIFRLogger.deliveryStorePrepared(deliveryStorePreparationMilliseconds)
    #endif

    clipsToBounds = true
    lynxView.layoutWidthMode = .exact
    lynxView.layoutHeightMode = .exact
    lynxView.addLifecycleClient(self)
    addSubview(lynxView)

    if bounds.size.width > 0 && bounds.size.height > 0 {
      applyLayout(bounds.size)
    }
  }

  deinit {
    deliveryTask?.cancel()
    watchdogWorkItem?.cancel()
    // Lock-guarded and nonisolated — safe to call directly, no main hop.
    ExpoLynxResourceRoots.shared.removeOwner(ObjectIdentifier(self))

    // `deinit` is nonisolated and runs on whatever thread drops the last
    // reference. Now that Lynx delivers callbacks from its own threads
    // (LynxView.mm:1145, :838) — and each call transiently retains `self` —
    // that thread may not be main. Two things here are unsafe off the main
    // thread:
    //   1. the pending completions reach a `@MainActor` `ReloadCompletion`
    //      that resumes a `CheckedContinuation` (F3);
    //   2. `LynxView.clearForDestroy` silently skips
    //      `[_templateRender.lynxUIRenderer reset]` and instead reports
    //      `ECLynxThreadWrongThreadDestroyError` when off the UI thread
    //      (LynxView.mm:130-146).
    // Push both onto the main queue. `self` is never captured; the completions
    // and the view are — both safe to escape a deallocating object.
    let pendingCompletions: [(Result<Void, Error>) -> Void] =
      [forceReloadCompletion, deferredForceReload?.completion].compactMap { $0 }
    let view = lynxView

    DispatchQueue.main.async {
      for completion in pendingCompletions {
        completion(.failure(CancellationError()))
      }
      // `removeLifecycleClient(self)` is deliberately not called: the
      // dispatcher holds clients in an `NSPointerFunctionsWeakMemory`
      // `NSHashTable` (LynxLifecycleDispatcher.m:18), so the weak entry has
      // already zeroed by the time `deinit` runs. `clearForDestroy` is
      // idempotent (`_templateRender = nil`), so `LynxView.dealloc`'s own call
      // (LynxView.mm:119) stays safe.
      view.clearForDestroy()
    }
  }

  // MARK: - Thread discipline at the Lynx boundary

  #if DEBUG
    /// Trips in debug when a method that must be main-thread-only is reached
    /// off the main thread — converts F1's silent state corruption into a
    /// crash at the exact call site.
    private func assertMain(_ fn: StaticString = #function) {
      assert(Thread.isMainThread, "\(fn) must run on the main thread")
    }
  #else
    @inline(__always) private func assertMain(_ fn: StaticString = #function) {}
  #endif

  /// Run `work` on the main thread — synchronously when already there so the
  /// common case adds no runloop turn, otherwise asynchronously.
  ///
  /// Typed `@MainActor` because every call site is `@MainActor`. Lynx can still
  /// invoke the enclosing lifecycle method from a background thread
  /// (LynxView.mm:1145, :838); the compiler cannot see that across the ObjC
  /// boundary, so `Thread.isMainThread` is the real guard — the synchronous
  /// `work()` branch runs only when the check genuinely passes.
  private func onMain(_ work: @escaping @MainActor @Sendable () -> Void) {
    if Thread.isMainThread {
      work()
    } else {
      DispatchQueue.main.async(execute: work)
    }
  }

  // MARK: - Layout

  override func layoutSubviews() {
    super.layoutSubviews()

    lynxView.frame = bounds

    if bounds.size != lastLayoutSize {
      // First viewport goes through `applyLayout` synchronously so the initial
      // load is not delayed; later size changes coalesce (F16).
      if hasViewport {
        scheduleViewportUpdate(bounds.size)
      } else {
        applyLayout(bounds.size)
      }
    }

    // F12: a load that arrived before the viewport was known resumes now.
    if let pending = pendingLoadTarget,
      bounds.size.width > 0, bounds.size.height > 0
    {
      pendingLoadTarget = nil
      loadTarget(pending.target, generation: pending.generation)
    }
  }

  // NOTE: safe-area insets are intentionally not forwarded to Lynx global props
  // right now (removed by request). Re-add via `safeAreaInsetsDidChange` +
  // `updateGlobalProps(["safeAreaTop": …])`, seeding the values into the
  // initial `LynxTemplateData` before first load to avoid the mount-time double
  // render (F17 in docs/ios-concurrency-lifecycle-remediation.md).

  private func applyLayout(_ size: CGSize) {
    lastLayoutSize = size
    hasViewport = true
    lynxView.updateViewport(
      withPreferredLayoutWidth: size.width,
      preferredLayoutHeight: size.height,
      needLayout: true
    )
  }

  /// Coalesce a viewport change to the next runloop turn — used for size
  /// changes *after* the first viewport, so a continuous resize triggers one
  /// Lynx relayout instead of one per frame (F16).
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

  // MARK: - React props

  func setSource(_ value: String?) {
    let nextSource = value?.trimmingCharacters(in: .whitespacesAndNewlines)
    guard nextSource != legacySource else {
      return
    }

    legacySource = nextSource
    sourceNeedsReload = true
  }

  func setSourceJSON(_ value: String?) {
    guard value != sourceJSON else {
      return
    }

    sourceJSON = value
    sourceNeedsReload = true
  }

  func setInitialDataJSON(_ value: String?) {
    guard value != initialDataJSON else {
      return
    }

    initialDataJSON = value
    initialDataNeedsUpdate = true
  }

  func applyPendingUpdate() {
    if sourceNeedsReload {
      scheduleLoad()
      return
    }

    applyPendingInitialDataUpdate()
  }

  func reload() {
    // `AsyncFunction("reload")` may invoke this off the main thread, and
    // everything `scheduleLoad` touches is main-actor state.
    onMain { [weak self] in self?.scheduleLoad() }
  }
}

extension ExpoLynxView {

  // MARK: - Initial source selection

  fileprivate func scheduleLoad() {
    sourceNeedsReload = false
    loadGeneration += 1
    hasLoadedTemplate = false
    deliveryTask?.cancel()
    watchdogWorkItem?.cancel()
    forceReloadCompletion?(.failure(CancellationError()))
    forceReloadCompletion = nil
    deferredForceReload?.completion(.failure(CancellationError()))
    deferredForceReload = nil
    deferredDeliveryError = nil
    managedDeliveryStartedGeneration = nil
    currentTarget = nil
    pendingLoadTarget = nil
    LynxManagedViewRegistry.shared.unregister(self)
    managedFeature = nil

    let generation = loadGeneration
    #if DEBUG || LYNX_IFR_METRICS
      sourceSelectionStartedAt = Date()
    #endif
    // F11: no runloop hop. `applyPendingUpdate` is already the batched
    // "all props applied" main-thread callback, and `loadTarget` now gates on
    // the viewport itself (F12) instead of relying on this hop to let layout
    // win the race. `reload()` hops to main before calling in.
    loadSource(generation: generation)
  }

  // Initial render flow:
  //
  // scheduleLoad
  //      |
  // loadSource -> decode and select source kind
  //      |
  // loadEmbedded / loadDevelopment / loadManaged
  //      |                           (pending -> active -> embedded)
  // loadTarget
  //      |
  // LynxView.loadTemplate
  fileprivate func loadSource(generation: Int) {
    guard let sourceJSON, !sourceJSON.isEmpty else {
      loadLegacySource(generation: generation)
      return
    }

    guard let payload = ExpoLynxSourcePayload(jsonString: sourceJSON) else {
      emitError(
        url: "",
        feature: "",
        stage: .manifest,
        code: "ERR_LYNX_SOURCE_INVALID",
        message: "Could not decode the Lynx source configuration."
      )
      return
    }
    load(payload, generation: generation)
  }

  fileprivate func load(_ payload: ExpoLynxSourcePayload, generation: Int) {
    switch payload.kind {
    case "embedded":
      guard let feature = payload.feature?.trimmingCharacters(in: .whitespacesAndNewlines),
        !feature.isEmpty
      else {
        emitError(
          url: "",
          feature: "",
          stage: .manifest,
          code: "ERR_LYNX_EMBEDDED_FEATURE",
          message: "An embedded Lynx source requires a feature name."
        )
        return
      }
      loadEmbedded(feature: feature, generation: generation)
    case "development":
      loadDevelopment(url: payload.url, generation: generation)
    case "managed":
      loadManaged(payload: payload, generation: generation)
    default:
      emitError(
        url: "",
        feature: payload.feature ?? "",
        stage: .manifest,
        code: "ERR_LYNX_SOURCE_KIND",
        message: "Unsupported Lynx source kind: \(payload.kind)"
      )
    }
  }

  fileprivate func loadLegacySource(generation: Int) {
    guard let legacySource, !legacySource.isEmpty else { return }
    #if DEBUG
      loadDevelopment(url: legacySource, generation: generation)
    #else
      if let remoteURL = URL(string: legacySource),
        ["http", "https"].contains(remoteURL.scheme?.lowercased())
      {
        emitError(
          url: legacySource,
          feature: "",
          stage: .manifest,
          code: "ERR_LYNX_REMOTE_SOURCE_FORBIDDEN",
          message: "Raw remote Lynx URLs are forbidden in Release builds."
        )
      } else {
        loadTarget(
          ExpoLynxLoadTarget(
            url: legacySource,
            feature: "",
            version: "embedded",
            source: "embedded",
            managedFeature: nil,
            managedRuntimeVersion: nil,
            candidateManifestID: nil
          ),
          generation: generation
        )
      }
    #endif
  }

  fileprivate func loadDevelopment(url: String?, generation: Int) {
    guard let url, !url.isEmpty else {
      emitError(
        url: "",
        feature: "",
        stage: .manifest,
        code: "ERR_LYNX_DEVELOPMENT_URL",
        message: "A development Lynx source requires a URL."
      )
      return
    }

    #if DEBUG
      loadTarget(
        ExpoLynxLoadTarget(
          url: url,
          feature: "",
          version: "development",
          source: "development",
          managedFeature: nil,
          managedRuntimeVersion: nil,
          candidateManifestID: nil
        ),
        generation: generation
      )
    #else
      emitError(
        url: url,
        feature: "",
        stage: .manifest,
        code: "ERR_LYNX_DEVELOPMENT_FORBIDDEN",
        message: "Development Lynx sources are forbidden in Release builds."
      )
    #endif
  }

  // F13: the embedded name a feature resolves to is fixed for the process
  // (embedded assets are immutable). Memoise it so `loadEmbedded` stops
  // re-probing the file system on every mount / fallback.
  private static let embeddedNameLock = NSLock()
  private static var embeddedNameByFeature: [String: String] = [:]

  fileprivate func loadEmbedded(feature: String, generation: Int) {
    let embeddedName: String
    ExpoLynxView.embeddedNameLock.lock()
    let memo = ExpoLynxView.embeddedNameByFeature[feature]
    ExpoLynxView.embeddedNameLock.unlock()

    if let memo {
      embeddedName = memo
    } else {
      let v2Name = "ExpoLynxEmbedded.bundle/\(feature)/main.lynx.bundle"
      let resolved: String
      if resolveLocalURL(v2Name) != nil {
        resolved = v2Name
      } else {
        // Preserve legacy prebuild output during migration. V2 app configs use
        // the branch above and never duplicate these bytes in the asset graph.
        resolved = resolveLocalURL("\(feature).lynx") == nil ? "static.lynx" : "\(feature).lynx"
      }
      ExpoLynxView.embeddedNameLock.lock()
      ExpoLynxView.embeddedNameByFeature[feature] = resolved
      ExpoLynxView.embeddedNameLock.unlock()
      embeddedName = resolved
    }

    loadTarget(
      ExpoLynxLoadTarget(
        url: embeddedName,
        feature: feature,
        version: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
          ?? "embedded",
        source: "embedded",
        managedFeature: nil,
        managedRuntimeVersion: nil,
        candidateManifestID: nil
      ),
      generation: generation
    )
  }

}

extension ExpoLynxView {

  // MARK: - Managed delivery

  private func loadManaged(payload: ExpoLynxSourcePayload, generation: Int) {
    guard let feature = payload.feature?.trimmingCharacters(in: .whitespacesAndNewlines),
      !feature.isEmpty
    else {
      emitError(
        url: "",
        feature: "",
        stage: .manifest,
        code: "ERR_LYNX_MANAGED_FEATURE",
        message: "A managed Lynx source requires a feature name."
      )
      return
    }

    managedFeature = feature
    LynxManagedViewRegistry.shared.register(self)

    let runtimeVersion: String
    do {
      runtimeVersion = try LynxManagedDeliveryConfiguration.runtimeVersion()
    } catch {
      emitDeliveryError(error, fallbackURL: "", feature: feature)
      loadEmbedded(feature: feature, generation: generation)
      return
    }

    let state = LynxManagedDeploymentState.shared.recover(
      feature: feature,
      runtimeVersion: runtimeVersion
    )
    if let pendingID = state.pendingReleaseID,
      let pending = LynxManagedBundleStore.shared.launchInstalledRelease(
        feature: feature,
        releaseID: pendingID,
        expectedRuntimeVersion: runtimeVersion
      )
    {
      LynxManagedDeploymentState.shared.beginAttempt(
        releaseID: pendingID,
        feature: feature,
        runtimeVersion: runtimeVersion
      )
      loadManagedRelease(
        pending,
        candidate: true,
        generation: generation
      )
    } else if let activeID = state.activeReleaseID,
      let active = LynxManagedBundleStore.shared.launchInstalledRelease(
        feature: feature,
        releaseID: activeID,
        expectedRuntimeVersion: runtimeVersion
      )
    {
      loadManagedRelease(
        active,
        candidate: false,
        generation: generation
      )
    } else {
      loadEmbedded(feature: feature, generation: generation)
    }
  }

  private func startManagedDelivery(
    feature: String,
    generation: Int
  ) {
    guard generation == loadGeneration,
      managedFeature == feature,
      managedDeliveryStartedGeneration != generation
    else { return }
    managedDeliveryStartedGeneration = generation
    #if DEBUG || LYNX_IFR_METRICS
      let deliveryStartMilliseconds = currentLoadDurationMilliseconds()
      LynxIFRLogger.deliveryStarted(deliveryStartMilliseconds, feature: feature)
    #endif

    let deploymentURL: URL
    do {
      deploymentURL = try LynxManagedDeliveryConfiguration.deploymentURL(
        feature: feature
      )
    } catch {
      emitDeliveryError(error, fallbackURL: "", feature: feature)
      return
    }

    deliveryTask = Task { @MainActor [weak self] in
      guard let self, generation == self.loadGeneration else { return }
      do {
        self.emitUpdate(["feature": feature, "phase": "checking"])
        let result = try await LynxManagedDeliveryCoordinator.shared.checkForUpdate(
          feature: feature,
          deploymentURL: deploymentURL
        )
        guard !Task.isCancelled, generation == self.loadGeneration else { return }
        self.emitUpdate(result.eventPayload(phase: result.status.rawValue))
      } catch {
        // F22: `checkForUpdate` can surface a cancellation wrapped in a
        // `LynxDeliveryError` or as `URLError(.cancelled)` — neither matches
        // `is CancellationError`. Swallow all cancellation shapes so a
        // deliberately-cancelled check emits no spurious `onUpdate`/`onError`.
        if error is CancellationError || Task.isCancelled { return }
        if (error as? URLError)?.code == .cancelled { return }
        guard generation == self.loadGeneration else { return }
        self.emitUpdateError(error, feature: feature)
        self.emitDeliveryError(
          error,
          fallbackURL: deploymentURL.absoluteString,
          feature: feature
        )
      }
    }
  }

  private func loadManagedRelease(
    _ release: LynxManagedRelease,
    candidate: Bool,
    generation: Int
  ) {
    let manifestID = candidate ? release.manifestID : nil
    let runtimeVersion: String
    do {
      runtimeVersion = try LynxManagedDeliveryConfiguration.runtimeVersion()
    } catch {
      // F5: a release whose runtime version can't be resolved can never be
      // confirmed or rolled back. Route through `failCandidate` — its
      // unconditional block resolves any pending force-reload completion and
      // clears the watchdog, then the nil-runtime-version branch falls back to
      // the embedded bundle. Previously this was a silent `try?` → nil that
      // `failCandidate`'s old top guard then dropped on the floor.
      failCandidate(
        ExpoLynxLoadTarget(
          url: release.bundleURL.absoluteString,
          feature: release.feature,
          version: release.version,
          source: "cache",
          managedFeature: release.feature,
          managedRuntimeVersion: nil,
          candidateManifestID: manifestID
        ),
        error: error,
        generation: generation
      )
      return
    }
    loadTarget(
      ExpoLynxLoadTarget(
        url: release.bundleURL.absoluteString,
        feature: release.feature,
        version: release.version,
        source: "cache",
        managedFeature: release.feature,
        managedRuntimeVersion: runtimeVersion,
        candidateManifestID: manifestID
      ),
      generation: generation
    )
  }

  func forceReloadManagedRelease(
    _ release: LynxManagedRelease,
    completion: @escaping (Result<Void, Error>) -> Void
  ) {
    guard managedFeature == release.feature else {
      completion(
        .failure(
          LynxDeliveryError(
            stage: .lynx,
            code: "ERR_LYNX_FORCE_VIEW_MISMATCH",
            message: "The mounted Lynx view no longer matches the forced release."
          )
        )
      )
      return
    }
    // A coordinator has already completed the deployment request that produced
    // this force reload; do not start the view's automatic check as well.
    managedDeliveryStartedGeneration = loadGeneration

    guard currentLoadGate.isReady else {
      deferredForceReload?.completion(.failure(CancellationError()))
      deferredForceReload = (release, completion)
      return
    }

    performForceReload(release, completion: completion)
  }

  private func performForceReload(
    _ release: LynxManagedRelease,
    completion: @escaping (Result<Void, Error>) -> Void
  ) {
    forceReloadCompletion?(.failure(CancellationError()))
    forceReloadCompletion = completion
    emitUpdate([
      "feature": release.feature,
      "phase": "reloading",
      "releaseId": release.manifestID,
      "version": release.version,
    ])
    loadManagedRelease(
      release,
      candidate: true,
      generation: loadGeneration
    )
  }

}

extension ExpoLynxView {

  // MARK: - Template loading

  fileprivate func loadTarget(_ target: ExpoLynxLoadTarget, generation: Int) {
    guard generation == loadGeneration else { return }

    // F12: never start a load at a zero/default viewport. If bounds are known,
    // set the viewport synchronously first; otherwise stash the target and let
    // `layoutSubviews` drive it once a real size arrives. Nothing below this
    // guard has mutated per-load state yet, so re-entry from `layoutSubviews`
    // is clean. A forced reload never hits this — the view already has a
    // viewport by then.
    if !hasViewport {
      if bounds.size.width > 0, bounds.size.height > 0 {
        applyLayout(bounds.size)
      } else {
        pendingLoadTarget = (target, generation)
        return
      }
    }

    #if DEBUG || LYNX_IFR_METRICS
      let sourceSelectionMilliseconds = sourceSelectionStartedAt.map {
        max(0, Int(Date().timeIntervalSince($0) * 1_000))
      } ?? 0
      LynxIFRLogger.sourceSelected(
        sourceSelectionMilliseconds,
        feature: target.feature,
        source: target.source
      )
      sourceSelectionStartedAt = nil
    #endif
    hasLoadedTemplate = false
    currentLoadGate = LynxInitialLoadGate()
    currentTarget = target
    loadToken = UUID()
    loadStartedAt = Date()
    // Set the per-view provider's root AND mirror it into the process-wide
    // registry, so a prewarmed runtime (which can only ever hold
    // `ExpoLynxTemplateProvider.shared`) resolves this view's sidecar
    // resources too (F4). The registry keeps the previous root as well, so a
    // superseded load's in-flight fetches still resolve (F7).
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
    onLoadStart(eventPayload(for: target))
    // F18: the view is revealed in `handleFirstScreen`, once the new content
    // has actually painted — not here. Un-hiding at load *start* re-showed the
    // previous render's stale pixels until first screen, after a failed load
    // had hidden the view. `finishWithError` / `handleError` still hide on
    // failure; `isHidden` remains the only safe wipe-but-stay-alive lever.

    if let remoteURL = URL(string: target.url),
      ["http", "https"].contains(remoteURL.scheme?.lowercased())
    {
      // Match Lynx Explorer: let Lynx own the remote load so DevTool's
      // Page.reload uses the same template-resource-fetcher pipeline.
      lynxView.loadTemplate(
        fromURL: remoteURL.absoluteString,
        initData: consumeTemplateDataForLoad()
      )
      return
    }

    guard let localURL = resolveLocalURL(target.url) else {
      let error = LynxDeliveryError(
        stage: .resource,
        code: "ERR_LYNX_SOURCE_NOT_FOUND",
        message: "Could not find the Lynx bundle in the app bundle or at the supplied file URL."
      )
      if target.candidateManifestID != nil {
        failCandidate(target, error: error, generation: generation)
      } else {
        lynxView.isHidden = true
        emitDeliveryError(error, fallbackURL: target.url, feature: target.feature)
      }
      return
    }

    loadLocalURL(localURL, target: target, generation: generation, token: loadToken)
    if target.candidateManifestID != nil, !currentLoadGate.isReady {
      startWatchdog(target: target, generation: generation)
    }
  }

  // Decoded template bundles, reused across mounts / reloads of the same binary.
  // `LynxTemplateBundle` is the SDK's PreDecode product: parsing the App Bundle
  // once, on a background queue, keeps the template binary decode out of
  // `LynxView.loadTemplate`, which otherwise runs it synchronously on the main
  // thread on every load.
  private static let templateBundleCache: NSCache<NSString, LynxTemplateBundle> = {
    let cache = NSCache<NSString, LynxTemplateBundle>()
    cache.countLimit = 8
    return cache
  }()

  private static let templateDecodeQueue = DispatchQueue(
    label: "com.expo.lynx.template-decode",
    qos: .userInitiated
  )

  private static let cacheKeyLock = NSLock()
  private static var cacheKeyByPath: [String: NSString] = [:]

  // Key on path + size + mtime so a rebuilt bundle at the same path busts the
  // entry. Within one process (size, mtime) never changes for a given path —
  // embedded assets are immutable, managed releases land in unique per-release
  // directories, dev bundles go through the remote-URL path — so the key is
  // memoised by path (F13) and only the first load of each path pays the stat.
  private static func templateCacheKey(for url: URL) -> NSString? {
    let path = url.path

    cacheKeyLock.lock()
    if let cached = cacheKeyByPath[path] {
      cacheKeyLock.unlock()
      return cached
    }
    cacheKeyLock.unlock()

    guard
      let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
    else {
      return nil
    }
    let size = values.fileSize ?? 0
    // Full sub-second precision (§8.2): the previous `Int(...)` truncation
    // collided across a same-second rebuild producing an identically-sized
    // bundle.
    let mtime = values.contentModificationDate?.timeIntervalSince1970 ?? 0
    let key = "\(path)|\(size)|\(mtime)" as NSString

    cacheKeyLock.lock()
    cacheKeyByPath[path] = key
    cacheKeyLock.unlock()
    return key
  }

  fileprivate func loadLocalURL(
    _ url: URL,
    target: ExpoLynxLoadTarget,
    generation: Int,
    token: UUID
  ) {
    let cacheKey = ExpoLynxView.templateCacheKey(for: url)

    // Fast path: a bundle decoded on an earlier mount is reused with no I/O
    // and no decode on the main thread.
    if let cacheKey, let cached = ExpoLynxView.templateBundleCache.object(forKey: cacheKey) {
      guard generation == loadGeneration, token == loadToken else { return }
      // ObjC `loadTemplateBundle:withURL:initData:` imports into Swift as
      // `load(_:withURL:initData:)`.
      lynxView.load(
        cached,
        withURL: target.url,
        initData: consumeTemplateDataForLoad()
      )
      return
    }

    // F14: build `LynxTemplateData` on the decode queue too, not on the main
    // continuation. Snapshot the JSON now (on main); the
    // `initialDataNeedsUpdate` side effect still runs on main, below.
    let initialDataJSONSnapshot = initialDataJSON

    ExpoLynxView.templateDecodeQueue.async { [weak self] in
      let outcome: Result<(LynxTemplateBundle?, Data), Error>
      do {
        let data = try Data(contentsOf: url, options: .mappedIfSafe)
        let bundle = LynxTemplateBundle(template: data)
        if let bundle, bundle.errorMsg() == nil {
          outcome = .success((bundle, data))
        } else {
          // Pre-decode produced an invalid bundle; keep the raw bytes so the
          // main thread can fall back and let LynxView surface the real error.
          outcome = .success((nil, data))
        }
      } catch {
        outcome = .failure(error)
      }

      let initData: LynxTemplateData? = {
        guard let json = initialDataJSONSnapshot, !json.isEmpty else { return nil }
        return LynxTemplateData(json: json, useBoolLiterals: true)
      }()

      DispatchQueue.main.async {
        // F15: cache the decoded bundle whether or not this view still exists.
        // The decode is already paid for; the next mount of the same binary
        // should hit the fast path instead of re-decoding. `NSCache` is
        // thread-safe and this needs only `outcome` + `cacheKey`, both captured.
        if case .success(let (bundle, _)) = outcome, let bundle, let cacheKey {
          ExpoLynxView.templateBundleCache.setObject(bundle, forKey: cacheKey)
        }

        guard let self, generation == self.loadGeneration,
          token == self.loadToken
        else { return }

        switch outcome {
        case .failure(let error):
          self.finishWithError(error, target: target, generation: generation)
        case .success(let (bundle, data)):
          // Main-actor side effect of consuming the pending initial data —
          // only on the path that actually hands `initData` to the engine,
          // matching the previous `consumeTemplateDataForLoad()` placement.
          self.initialDataNeedsUpdate = false
          if let bundle {
            self.lynxView.load(
              bundle,
              withURL: target.url,
              initData: initData
            )
          } else {
            self.lynxView.loadTemplate(
              data,
              withURL: target.url,
              initData: initData
            )
          }
        }
      }
    }
  }

  fileprivate func finishWithError(_ error: Error, target: ExpoLynxLoadTarget, generation: Int) {
    guard generation == loadGeneration else { return }

    if target.candidateManifestID != nil {
      failCandidate(target, error: error, generation: generation)
      return
    }

    // ponytail: hide the previous render so a failed reload doesn't
    // show the stale bundle. The engine keeps its internal state, but
    // the visible pixels are gone. The next successful load un-hides
    // via loadSource's setSource path.
    lynxView.isHidden = true

    let payload = ExpoLynxView.errorPayload(for: error)
    emitError(
      url: target.url,
      feature: target.feature,
      stage: .lynx,
      code: payload.code,
      message: payload.message
    )
  }

  fileprivate static func errorPayload(for error: Error) -> (
    code: String, message: String
  ) {
    let nsError = error as NSError
    let info = nsError.userInfo

    if let underlying = info[NSUnderlyingErrorKey] as? NSError {
      let nested = errorPayload(for: underlying)
      return (
        code: nested.code,
        message: "\(nested.message) (caused by \(nsError.domain) \(nsError.code))"
      )
    }

    if let reason = info["reason"] as? String, !reason.isEmpty {
      return (code: "\(nsError.code)", message: reason)
    }

    let detail =
      (info[NSDebugDescriptionErrorKey] as? String)
      ?? (info[NSLocalizedDescriptionKey] as? String)
      ?? nsError.localizedDescription
    return (code: "\(nsError.code)", message: detail)
  }

  fileprivate static func isMainBundleError(_ error: Error) -> Bool {
    guard let lynxError = error as? LynxError else {
      return false
    }

    // Lynx reserves the 1xx behavior-code section for AppBundle failures
    // (load, reload, verification, and legacy template-provider errors).
    // Resource failures such as images and fonts use 3xx codes and must not
    // blank an otherwise successfully rendered page.
    return lynxError.errorCode / 100 == 1
  }

  fileprivate func resolveLocalURL(_ value: String) -> URL? {
    if let exactURL = templateProvider.bundledResourceURL(for: value) {
      return exactURL
    }

    let normalizedName =
      value.hasPrefix("bundle://")
      ? String(value.dropFirst("bundle://".count)) : value
    return Bundle.main.url(forResource: normalizedName, withExtension: "bundle")
  }

  fileprivate func makeTemplateData() -> LynxTemplateData? {
    guard let initialDataJSON, !initialDataJSON.isEmpty else {
      return nil
    }

    return LynxTemplateData(json: initialDataJSON, useBoolLiterals: true)
  }

  fileprivate func consumeTemplateDataForLoad() -> LynxTemplateData? {
    initialDataNeedsUpdate = false
    return makeTemplateData()
  }

  fileprivate func applyPendingInitialDataUpdate() {
    guard initialDataNeedsUpdate, hasLoadedTemplate else { return }
    initialDataNeedsUpdate = false
    if let templateData = makeTemplateData() {
      lynxView.updateData(with: templateData)
    } else {
      // updateData(nil) is a no-op in Lynx. Reset with an empty object so
      // removing the React prop also removes the previous template data.
      lynxView.resetData(
        with: LynxTemplateData(json: "{}", useBoolLiterals: true)
      )
    }
  }

}

extension ExpoLynxView {

  // MARK: - Events and errors

  fileprivate func eventPayload(for target: ExpoLynxLoadTarget) -> [String: Any] {
    [
      "url": target.url,
      "feature": target.feature,
      "version": target.version,
      "source": target.source,
      "durationMs": currentLoadDurationMilliseconds(),
    ]
  }

  fileprivate func currentLoadDurationMilliseconds() -> Int {
    max(0, Int(Date().timeIntervalSince(loadStartedAt) * 1_000))
  }

  fileprivate func emitDeliveryError(_ error: Error, fallbackURL: String, feature: String) {
    if let deliveryError = error as? LynxDeliveryError {
      emitError(
        url: fallbackURL,
        feature: feature,
        stage: deliveryError.stage,
        code: deliveryError.code,
        message: deliveryError.message
      )
      return
    }

    let payload = ExpoLynxView.errorPayload(for: error)
    emitError(
      url: fallbackURL,
      feature: feature,
      stage: .download,
      code: payload.code,
      message: payload.message
    )
  }

  fileprivate func emitUpdate(_ payload: [String: Any]) {
    onUpdate(payload)
  }

  fileprivate func emitUpdateError(_ error: Error, feature: String) {
    if let deliveryError = error as? LynxDeliveryError {
      emitUpdate([
        "feature": feature,
        "phase": "error",
        "code": deliveryError.code,
        "message": ExpoLynxView.redactedEventMessage(deliveryError.message),
      ])
      return
    }
    emitUpdate([
      "feature": feature,
      "phase": "error",
      "code": "ERR_LYNX_UPDATE",
      "message": ExpoLynxView.redactedEventMessage(error.localizedDescription),
    ])
  }

  fileprivate func emitError(
    url: String,
    feature: String,
    stage: LynxDeliveryStage,
    code: String,
    message: String
  ) {
    onError([
      "url": url,
      "feature": feature,
      "stage": stage.rawValue,
      "code": code,
      "message": ExpoLynxView.redactedEventMessage(message),
    ])
  }

  /// Native errors can contain a failed request URL. Events cross the RN
  /// boundary and may be forwarded to analytics, so remove query credentials
  /// and URL user/password components before dispatching them.
  fileprivate static func redactedEventMessage(_ message: String) -> String {
    // F24: truncate first, and skip words that cannot be URLs before paying for
    // a `URLComponents` parse. The `://` pre-filter is safe — the guard below
    // only keeps a word when it parses with both a scheme and a host, which
    // requires `://`.
    let truncated = message.prefix(500)
    let words = truncated.split(separator: " ", omittingEmptySubsequences: false).map {
      word -> String in
      guard word.contains("://") else { return String(word) }
      let suffix = word.reversed().prefix { ").,]".contains($0) }
      let core = String(word.dropLast(suffix.count))
      guard var components = URLComponents(string: core), components.scheme != nil,
        components.host != nil
      else {
        return String(word)
      }
      components.query = nil
      components.user = nil
      components.password = nil
      return (components.string ?? core) + String(suffix.reversed())
    }
    return words.joined(separator: " ")
  }

}

extension ExpoLynxView {

  // MARK: - Candidate health and fallback

  fileprivate func startWatchdog(target: ExpoLynxLoadTarget, generation: Int) {
    watchdogWorkItem?.cancel()
    let workItem = DispatchWorkItem { [weak self] in
      guard let self, generation == self.loadGeneration,
        self.currentTarget?.candidateManifestID == target.candidateManifestID
      else { return }
      let error = LynxDeliveryError(
        stage: .lynx,
        code: "ERR_LYNX_CANDIDATE_TIMEOUT",
        message: "The downloaded Lynx release did not finish loading within 15 seconds."
      )
      self.failCandidate(target, error: error, generation: generation)
    }
    watchdogWorkItem = workItem
    DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: workItem)
  }

  fileprivate func failCandidate(
    _ target: ExpoLynxLoadTarget,
    error: Error,
    generation: Int
  ) {
    assertMain()

    // Unconditional. `target.managedRuntimeVersion` is populated with `try?`
    // in `loadManagedRelease` and can legitimately be nil; if the obligations
    // below are gated on the release triple, a nil runtime version silently
    // drops the error, leaks the watchdog, and hangs `reloadMountedViews`'
    // continuation for the process lifetime (F5).
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
      // Without the full triple we cannot record the failure in
      // `LynxManagedDeploymentState` or choose a fallback release. Load the
      // embedded bundle so the view is not left blank.
      if let feature = target.managedFeature ?? managedFeature {
        loadEmbedded(feature: feature, generation: generation)
      }
      return
    }

    LynxManagedDeploymentState.shared.fail(
      releaseID: manifestID,
      feature: feature,
      runtimeVersion: runtimeVersion
    )
    let state = LynxManagedDeploymentState.shared.recover(
      feature: feature,
      runtimeVersion: runtimeVersion
    )
    if let activeID = state.activeReleaseID,
      activeID != manifestID,
      let active = LynxManagedBundleStore.shared.launchInstalledRelease(
        feature: feature,
        releaseID: activeID,
        expectedRuntimeVersion: runtimeVersion
      )
    {
      loadManagedRelease(
        active,
        candidate: false,
        generation: generation
      )
    } else {
      loadEmbedded(feature: feature, generation: generation)
    }
  }

}

extension ExpoLynxView {

  // MARK: - LynxViewLifecycle (thread-normalising entry points)
  //
  // Lynx guarantees main-thread delivery only for `lynxViewDidFirstScreen`
  // (LynxView.mm:1123). `didLoadFinishedWithUrl:` and `didRecieveError:` are
  // invoked synchronously on the producing thread (LynxView.mm:1145, :838) —
  // for a resource failure that is this module's own `ExpoLynxTemplateProvider`
  // completion queue. Snapshot the generation off-main, then hop; every
  // `handle*` body below is main-thread-only and starts with `assertMain()`.

  func lynxView(_ view: LynxView, didLoadFinishedWithUrl url: String) {
    let generation = generationBox.current
    onMain { [weak self] in
      self?.handleLoadFinished(url: url, generation: generation)
    }
  }

  /// Lynx may report the post-redirect URL for a load, and this module's own
  /// `ExpoLynxTemplateProvider.shouldRedirectUrl` rewrites local requests to
  /// absolute file URLs. Compare on standardized file paths, falling back to
  /// absolute-string equality for remote URLs (F6).
  private static func isSameTemplateURL(_ lhs: String, _ rhs: String) -> Bool {
    if lhs == rhs { return true }
    guard let l = URL(string: lhs), let r = URL(string: rhs) else { return false }
    if l.isFileURL && r.isFileURL {
      return l.standardizedFileURL.path == r.standardizedFileURL.path
    }
    return l.absoluteString == r.absoluteString
  }

  private func handleLoadFinished(url: String, generation: Int) {
    assertMain()
    guard generation == loadGeneration else { return }
    guard let target = currentTarget else { return }
    if !url.isEmpty, !ExpoLynxView.isSameTemplateURL(url, target.url) {
      // The generation guard already scoped this to the current load. A
      // same-generation URL that still doesn't match is almost certainly
      // `shouldRedirectUrl` normalisation we didn't account for — proceed
      // anyway. Returning here would strand the gate until the 15s watchdog
      // fails a healthy release (F6).
      assertionFailure("load-finished URL \(url) != current target \(target.url)")
    }
    hasLoadedTemplate = true
    currentLoadGate.recordLoadFinished()
    #if DEBUG || LYNX_IFR_METRICS
      let loadFinishedMilliseconds = currentLoadDurationMilliseconds()
      LynxIFRLogger.loadFinished(
        loadFinishedMilliseconds,
        feature: target.feature,
        source: target.source
      )
    #endif
    applyPendingInitialDataUpdate()
    completeCurrentLoadHealthIfReady()
  }

  func lynxViewDidFirstScreen(_ view: LynxView) {
    let generation = generationBox.current
    onMain { [weak self] in
      self?.handleFirstScreen(generation: generation)
    }
  }

  private func handleFirstScreen(generation: Int) {
    assertMain()
    guard generation == loadGeneration else { return }
    guard let target = currentTarget, currentLoadGate.recordFirstScreen() else { return }

    let firstScreenMilliseconds = currentLoadDurationMilliseconds()
    #if DEBUG || LYNX_IFR_METRICS
      LynxIFRLogger.firstScreen(
        firstScreenMilliseconds,
        feature: target.feature,
        source: target.source
      )
    #endif
    // F18: reveal now that first screen has painted. Safe to call every time —
    // `finishWithError` / `handleError` re-hide on a subsequent failed load.
    lynxView.isHidden = false

    var payload = eventPayload(for: target)
    payload["durationMs"] = firstScreenMilliseconds
    onLoad(payload)

    if deferredDeliveryError != nil {
      let deferredGeneration = loadGeneration
      DispatchQueue.main.async { [weak self] in
        guard let self,
          deferredGeneration == self.loadGeneration,
          let deferredError = self.deferredDeliveryError
        else { return }
        self.deferredDeliveryError = nil
        self.emitDeliveryError(
          deferredError.error,
          fallbackURL: deferredError.fallbackURL,
          feature: deferredError.feature
        )
      }
    }

    completeCurrentLoadHealthIfReady()
  }

  private func completeCurrentLoadHealthIfReady() {
    guard currentLoadGate.consumeReady(), let target = currentTarget
    else { return }
    watchdogWorkItem?.cancel()

    if let manifestID = target.candidateManifestID,
      let feature = target.managedFeature,
      let runtimeVersion = target.managedRuntimeVersion
    {
      if forceReloadCompletion != nil {
        emitUpdate([
          "feature": feature,
          "phase": "reloaded",
          "releaseId": manifestID,
          "version": target.version,
        ])
        forceReloadCompletion?(.success(()))
        forceReloadCompletion = nil
      } else {
        LynxManagedDeploymentState.shared.confirm(
          releaseID: manifestID,
          feature: feature,
          runtimeVersion: runtimeVersion
        )
      }
    }

    if let feature = managedFeature {
      let generation = loadGeneration
      DispatchQueue.main.async { [weak self] in
        self?.startManagedDelivery(feature: feature, generation: generation)
      }
    }

    guard let deferred = deferredForceReload,
      managedFeature == deferred.release.feature
    else { return }
    deferredForceReload = nil
    performForceReload(
      deferred.release,
      completion: deferred.completion
    )
  }

  func lynxView(_ view: LynxView, didRecieveError error: Error) {
    let generation = generationBox.current
    onMain { [weak self] in
      self?.handleError(error, generation: generation)
    }
  }

  private func handleError(_ error: Error, generation: Int) {
    assertMain()
    guard generation == loadGeneration else { return }
    let target = currentTarget
    if ExpoLynxView.isMainBundleError(error) {
      if let target, target.candidateManifestID != nil {
        failCandidate(target, error: error, generation: generation)
        return
      }
      lynxView.isHidden = true
    }

    let url = lynxView.url ?? currentTarget?.url ?? ""
    let payload = ExpoLynxView.errorPayload(for: error)
    emitError(
      url: url,
      feature: target?.feature ?? "",
      stage: .lynx,
      code: payload.code,
      message: payload.message
    )
  }
}
