import ExpoModulesCore
import Lynx


private struct ExpoLynxSourcePayload: Decodable {
  let kind: String
  let feature: String?
  let url: String?
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
  private var loadGeneration = 0
  private var hasLoadedTemplate = false
  private var lastLayoutSize = CGSize.zero
  private var lastSafeAreaInsets: UIEdgeInsets?
  private var sourceNeedsReload = false
  private var initialDataNeedsUpdate = false
  private var currentTarget: ExpoLynxLoadTarget?
  // Retain only the validated declarative source configuration. This is the
  // authority for an explicit JS update check; JS never supplies a URL to the
  // imperative method.
  private var managedFeature: String?
  private var deliveryTask: Task<Void, Never>?
  private var watchdogWorkItem: DispatchWorkItem?
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
    syncSafeAreaInsets()

    if bounds.size.width > 0 && bounds.size.height > 0 {
      applyLayout(bounds.size)
    }
  }

  deinit {
    deliveryTask?.cancel()
    watchdogWorkItem?.cancel()
    forceReloadCompletion?(.failure(CancellationError()))
    deferredForceReload?.completion(.failure(CancellationError()))
    // `deinit` is nonisolated even for UIKit-bound instances. The registry
    // retains views weakly and prunes released entries on its next main-actor
    // access, so it is both safe and sufficient to skip actor-isolated cleanup
    // here. Live views still unregister synchronously in `scheduleLoad()`.
    lynxView.removeLifecycleClient(self)
    lynxView.clearForDestroy()
  }

  // MARK: - Layout

  override func layoutSubviews() {
    super.layoutSubviews()

    lynxView.frame = bounds
    syncSafeAreaInsets()
    guard bounds.size != lastLayoutSize else {
      return
    }

    applyLayout(bounds.size)
  }

  override func safeAreaInsetsDidChange() {
    super.safeAreaInsetsDidChange()
    syncSafeAreaInsets()
  }

  private func syncSafeAreaInsets() {
    let insets = safeAreaInsets
    guard insets != lastSafeAreaInsets else {
      return
    }
    lastSafeAreaInsets = insets

    // Lynx global props are host-owned, and the values are in the same point
    // coordinate space as this LynxView's viewport. Update only on change:
    // each global-props update causes Lynx to re-render the page.
    lynxView.updateGlobalProps(with: [
      "safeAreaTop": insets.top,
      "safeAreaBottom": insets.bottom,
      "safeAreaLeft": insets.left,
      "safeAreaRight": insets.right,
    ])
  }

  private func applyLayout(_ size: CGSize) {
    lastLayoutSize = size
    lynxView.updateViewport(
      withPreferredLayoutWidth: size.width,
      preferredLayoutHeight: size.height,
      needLayout: true
    )
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
    scheduleLoad()
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
    LynxManagedViewRegistry.shared.unregister(self)
    managedFeature = nil

    let generation = loadGeneration
    #if DEBUG || LYNX_IFR_METRICS
      sourceSelectionStartedAt = Date()
    #endif
    DispatchQueue.main.async { [weak self] in
      guard let self, generation == self.loadGeneration else {
        return
      }
      self.loadSource(generation: generation)
    }
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

    do {
      let payload = try JSONDecoder().decode(
        ExpoLynxSourcePayload.self,
        from: Data(sourceJSON.utf8)
      )
      load(payload, generation: generation)
    } catch {
      emitError(
        url: "",
        feature: "",
        stage: .manifest,
        code: "ERR_LYNX_SOURCE_INVALID",
        message: "Could not decode the Lynx source configuration: \(error.localizedDescription)"
      )
    }
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

  fileprivate func loadEmbedded(feature: String, generation: Int) {
    let v2Name = "ExpoLynxEmbedded.bundle/\(feature)/main.lynx.bundle"
    let embeddedName: String
    if resolveLocalURL(v2Name) != nil {
      embeddedName = v2Name
    } else {
      // Preserve legacy prebuild output during migration. V2 app configs use
      // the branch above and never duplicate these bytes in the asset graph.
      embeddedName = resolveLocalURL("\(feature).lynx") == nil ? "static.lynx" : "\(feature).lynx"
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
      } catch is CancellationError {
        return
      } catch {
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
    loadTarget(
      ExpoLynxLoadTarget(
        url: release.bundleURL.absoluteString,
        feature: release.feature,
        version: release.version,
        source: "cache",
        managedFeature: release.feature,
        managedRuntimeVersion: try? LynxManagedDeliveryConfiguration.runtimeVersion(),
        candidateManifestID: candidate ? release.manifestID : nil
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
    loadStartedAt = Date()
    if target.source == "cache", let bundleURL = URL(string: target.url), bundleURL.isFileURL {
      templateProvider.setLocalResourceRoot(bundleURL.deletingLastPathComponent())
    } else if target.source == "embedded", let bundleURL = resolveLocalURL(target.url) {
      templateProvider.setLocalResourceRoot(bundleURL.deletingLastPathComponent())
    } else {
      templateProvider.setLocalResourceRoot(nil)
    }
    onLoadStart(eventPayload(for: target))
    // ponytail: show the new template as soon as a load starts; if it
    // fails, finishWithError hides it again so the stale render isn't
    // left on screen. The engine has no public wipe-but-stay-alive API;
    // `isHidden` is the only safe way to drop visibility.
    lynxView.isHidden = false

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

    loadLocalURL(localURL, target: target, generation: generation)
    if target.candidateManifestID != nil, !currentLoadGate.isReady {
      startWatchdog(target: target, generation: generation)
    }
  }

  fileprivate func loadLocalURL(_ url: URL, target: ExpoLynxLoadTarget, generation: Int) {
    do {
      let data = try Data(contentsOf: url, options: .mappedIfSafe)
      guard generation == loadGeneration, currentTarget?.url == target.url else { return }
      lynxView.loadTemplate(
        data,
        withURL: target.url,
        initData: consumeTemplateDataForLoad()
      )
    } catch {
      finishWithError(error, target: target, generation: generation)
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
    let words = message.split(separator: " ", omittingEmptySubsequences: false).map {
      word -> String in
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
    return words.joined(separator: " ").prefix(500).description
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
    guard let manifestID = target.candidateManifestID,
      let feature = target.managedFeature,
      let runtimeVersion = target.managedRuntimeVersion
    else { return }

    watchdogWorkItem?.cancel()
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

  // MARK: - Lynx lifecycle

  func lynxView(_ view: LynxView, didLoadFinishedWithUrl url: String) {
    guard let target = currentTarget else { return }
    guard url.isEmpty || url == target.url else { return }
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
    guard let target = currentTarget, currentLoadGate.recordFirstScreen() else { return }

    let firstScreenMilliseconds = currentLoadDurationMilliseconds()
    #if DEBUG || LYNX_IFR_METRICS
      LynxIFRLogger.firstScreen(
        firstScreenMilliseconds,
        feature: target.feature,
        source: target.source
      )
    #endif
    var payload = eventPayload(for: target)
    payload["durationMs"] = firstScreenMilliseconds
    onLoad(payload)

    if deferredDeliveryError != nil {
      let generation = loadGeneration
      DispatchQueue.main.async { [weak self] in
        guard let self,
          generation == self.loadGeneration,
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
    let target = currentTarget
    if ExpoLynxView.isMainBundleError(error) {
      if let target, target.candidateManifestID != nil {
        failCandidate(target, error: error, generation: loadGeneration)
        return
      }
      view.isHidden = true
    }

    let url = view.url ?? currentTarget?.url ?? ""
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
