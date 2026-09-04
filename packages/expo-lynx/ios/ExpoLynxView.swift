import ExpoModulesCore
import Lynx

#if DEBUG
import OSLog
#endif

final class ExpoLynxTemplateProvider: NSObject, LynxTemplateProvider,
  LynxTemplateResourceFetcher, LynxGenericResourceFetcher, LynxMediaResourceFetcher
{
  static let shared = ExpoLynxTemplateProvider()
  private let resourceRootLock = NSLock()
  private var localResourceRoot: URL?

  func setLocalResourceRoot(_ url: URL?) {
    resourceRootLock.lock()
    localResourceRoot = url
    resourceRootLock.unlock()
  }

  private func currentLocalResourceRoot() -> URL? {
    resourceRootLock.lock()
    defer { resourceRootLock.unlock() }
    return localResourceRoot
  }

  func bundledResourceURL(for value: String) -> URL? {
    guard let resourceRoot = Bundle.main.resourceURL else { return nil }

    if let fileURL = URL(string: value), fileURL.isFileURL {
      if let localRoot = currentLocalResourceRoot(),
        let localURL = existingFileURL(fileURL, inside: localRoot)
      {
        return localURL
      }
      return existingFileURL(fileURL, inside: resourceRoot)
    }

    var resourcePath = value
    if resourcePath.hasPrefix("bundle://") {
      resourcePath.removeFirst("bundle://".count)
    } else if let parsedURL = URL(string: resourcePath), parsedURL.scheme != nil {
      return nil
    }

    resourcePath = (resourcePath.removingPercentEncoding ?? resourcePath)
      .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    let pathComponents = resourcePath.split(separator: "/", omittingEmptySubsequences: true)
    guard !pathComponents.isEmpty,
      !pathComponents.contains(where: { $0 == "." || $0 == ".." })
    else {
      return nil
    }

    if let localRoot = currentLocalResourceRoot(),
      let localURL = existingResourceURL(root: localRoot, components: pathComponents)
    {
      return localURL
    }

    return existingResourceURL(root: resourceRoot, components: pathComponents)
  }

  private func existingResourceURL(root: URL, components: [Substring]) -> URL? {
    let normalizedRoot = root.standardizedFileURL
    let candidate = components.reduce(normalizedRoot) { partialURL, component in
      partialURL.appendingPathComponent(String(component), isDirectory: false)
    }.standardizedFileURL
    return existingFileURL(candidate, inside: normalizedRoot)
  }

  private func existingFileURL(_ fileURL: URL, inside root: URL) -> URL? {
    let normalizedRoot = root.standardizedFileURL
    let candidate = fileURL.standardizedFileURL
    let rootPath =
      normalizedRoot.path.hasSuffix("/") ? normalizedRoot.path : normalizedRoot.path + "/"

    guard (candidate.path == normalizedRoot.path || candidate.path.hasPrefix(rootPath)),
      FileManager.default.fileExists(atPath: candidate.path),
      !candidate.hasDirectoryPath
    else {
      return nil
    }

    return candidate
  }

  @discardableResult
  private func loadData(
    from url: String,
    completion: @escaping (Data?, Error?) -> Void
  ) -> URLSessionDataTask? {
    if let localURL = bundledResourceURL(for: url) {
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let data = try Data(contentsOf: localURL, options: .mappedIfSafe)
          guard !data.isEmpty else {
            throw NSError(
              domain: "ExpoLynx",
              code: 1,
              userInfo: [NSLocalizedDescriptionKey: "The bundled Lynx resource was empty: \(url)"]
            )
          }
          completion(data, nil)
        } catch {
          completion(nil, error)
        }
      }
      return nil
    }

    guard let remoteURL = URL(string: url), let scheme = remoteURL.scheme?.lowercased(),
      scheme == "http" || scheme == "https"
    else {
      completion(
        nil,
        NSError(
          domain: "ExpoLynx",
          code: 1,
          userInfo: [NSLocalizedDescriptionKey: "The Lynx resource URL is invalid: \(url)"]
        )
      )
      return nil
    }

    var request = URLRequest(url: remoteURL)
    // Keep a failed LAN/CDN resource fetch from holding Lynx in a loading
    // state indefinitely. Managed downloads use the same 15-second bound.
    request.timeoutInterval = 15
    #if DEBUG
      // Development bundles and HMR assets must never reuse a stale response.
      request.cachePolicy = .reloadIgnoringLocalCacheData
      request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
    #else
      // Preserve normal HTTP caching in production while still checking with
      // the origin when the cached response requires revalidation.
      request.cachePolicy = .reloadRevalidatingCacheData
    #endif

    let task = URLSession.shared.dataTask(with: request) { data, response, error in
      if let error {
        completion(nil, error)
        return
      }

      if let response = response as? HTTPURLResponse, !(200...299).contains(response.statusCode) {
        completion(
          nil,
          NSError(
            domain: "ExpoLynx",
            code: response.statusCode,
            userInfo: [
              NSLocalizedDescriptionKey:
                "The Lynx bundle request returned HTTP \(response.statusCode)."
            ]
          )
        )
        return
      }

      guard let data, !data.isEmpty else {
        completion(
          nil,
          NSError(
            domain: "ExpoLynx",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "The Lynx bundle response was empty."]
          )
        )
        return
      }

      completion(data, nil)
    }
    task.resume()
    return task
  }

  func loadTemplate(withUrl url: String, onComplete callback: @escaping (Any?, Error?) -> Void) {
    loadData(from: url) { data, error in
      callback(data, error)
    }
  }

  func fetchTemplate(
    _ request: LynxResourceRequest,
    onComplete callback: @escaping (LynxTemplateResource?, Error?) -> Void
  ) {
    loadData(from: request.url) { data, error in
      callback(data.map { LynxTemplateResource(nsData: $0) }, error)
    }
  }

  func fetchSSRData(
    _ request: LynxResourceRequest,
    onComplete callback: @escaping (Data?, Error?) -> Void
  ) {
    loadData(from: request.url, completion: callback)
  }

  func fetchResource(
    _ request: LynxResourceRequest,
    onComplete callback: @escaping (Data?, Error?) -> Void
  ) -> () -> Void {
    let task = loadData(from: request.url, completion: callback)
    return {
      task?.cancel()
    }
  }

  func fetchResourcePath(
    _ request: LynxResourceRequest,
    onComplete callback: @escaping (String?, Error?) -> Void
  ) -> () -> Void {
    if let localURL = bundledResourceURL(for: request.url) {
      callback(localURL.path, nil)
      return {}
    }

    callback(
      nil,
      NSError(
        domain: "ExpoLynx",
        code: 1,
        userInfo: [
          NSLocalizedDescriptionKey:
            "Local resource paths are not supported for URL: \(request.url)"
        ]
      )
    )
    return {}
  }

  func shouldRedirectUrl(_ request: LynxResourceRequest) -> String {
    bundledResourceURL(for: request.url)?.absoluteString ?? request.url
  }
}

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
  #if DEBUG
    private static let performanceLogger = Logger(
      subsystem: "expo.lynx.view",
      category: "IFR"
    )
  #endif

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
  private var deferredForceReload: (
    release: LynxManagedRelease,
    completion: (Result<Void, Error>) -> Void
  )?
  private var deferredDeliveryError: (
    error: Error,
    fallbackURL: String,
    feature: String
  )?
  private var currentLoadGate = LynxInitialLoadGate()
  private var managedDeliveryStartedGeneration: Int?
  private var loadStartedAt = Date()

  var mountedManagedFeature: String? { managedFeature }

  required init(appContext: AppContext? = nil) {
    // Do not set screen metrics here. Lynx 4 marks screen-metric updates as
    // experimental and does not support multiple views with different metrics.
    // The per-view viewport is updated from this view's bounds in applyLayout.
    let provider = ExpoLynxTemplateProvider()
    templateProvider = provider
    lynxView = LynxView { builder in
      // Match Lynx Explorer: each view gets a config backed by the provider
      // prepared on LynxEnv, while the fetcher handles remote URL reloads.
      builder.config = LynxConfig(provider: provider)
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
      sourceNeedsReload = false
      scheduleLoad()
      return
    }

    applyPendingInitialDataUpdate()
  }

  func reload() {
    scheduleLoad()
  }

  private func scheduleLoad() {
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
  //      v
  // loadSource
  //      |
  //      +--> loadEmbedded -----------------------+
  //      +--> loadDevelopment --------------------+--> loadTarget --> loadTemplate
  //      +--> loadManaged --> pending/active/cache+
  //                            or embedded fallback
  private func loadSource(generation: Int) {
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

  private func load(_ payload: ExpoLynxSourcePayload, generation: Int) {
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

  private func loadLegacySource(generation: Int) {
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
            candidateManifestID: nil
          ),
          generation: generation
        )
      }
    #endif
  }

  private func loadDevelopment(url: String?, generation: Int) {
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

  private func loadEmbedded(feature: String, generation: Int) {
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
        candidateManifestID: nil
      ),
      generation: generation
    )
  }

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

    let state = LynxManagedDeploymentState.shared.recover(feature: feature)
    if let pendingID = state.pendingReleaseID,
      let pending = LynxManagedBundleStore.shared.launchInstalledRelease(
        feature: feature,
        releaseID: pendingID
      )
    {
      LynxManagedDeploymentState.shared.beginAttempt(
        releaseID: pendingID,
        feature: feature
      )
      loadManagedRelease(
        pending,
        candidate: true,
        generation: generation
      )
    } else if let activeID = state.activeReleaseID,
      let active = LynxManagedBundleStore.shared.launchInstalledRelease(
        feature: feature,
        releaseID: activeID
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
    #if DEBUG
      let deliveryStartMilliseconds = currentLoadDurationMilliseconds()
      Self.performanceLogger.notice(
        "delivery_start_ms=\(deliveryStartMilliseconds, privacy: .public) feature=\(feature, privacy: .public)"
      )
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

  private func loadTarget(_ target: ExpoLynxLoadTarget, generation: Int) {
    guard generation == loadGeneration else { return }
    hasLoadedTemplate = false
    currentLoadGate = LynxInitialLoadGate()
    currentTarget = target
    loadStartedAt = Date()
    if ["cache", "download"].contains(target.source), let bundleURL = URL(string: target.url), bundleURL.isFileURL {
      templateProvider.setLocalResourceRoot(bundleURL.deletingLastPathComponent())
    } else if target.source == "embedded", let bundleURL = resolveLocalURL(target.url) {
      templateProvider.setLocalResourceRoot(bundleURL.deletingLastPathComponent())
    } else { templateProvider.setLocalResourceRoot(nil) }
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

  private func loadLocalURL(_ url: URL, target: ExpoLynxLoadTarget, generation: Int) {
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

  private func finishWithError(_ error: Error, target: ExpoLynxLoadTarget, generation: Int) {
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

  private static func errorPayload(for error: Error) -> (
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

  private static func isMainBundleError(_ error: Error) -> Bool {
    guard let lynxError = error as? LynxError else {
      return false
    }

    // Lynx reserves the 1xx behavior-code section for AppBundle failures
    // (load, reload, verification, and legacy template-provider errors).
    // Resource failures such as images and fonts use 3xx codes and must not
    // blank an otherwise successfully rendered page.
    return lynxError.errorCode / 100 == 1
  }

  private func resolveLocalURL(_ value: String) -> URL? {
    if let exactURL = templateProvider.bundledResourceURL(for: value) {
      return exactURL
    }

    let normalizedName =
      value.hasPrefix("bundle://")
      ? String(value.dropFirst("bundle://".count)) : value
    return Bundle.main.url(forResource: normalizedName, withExtension: "bundle")
  }

  private func makeTemplateData() -> LynxTemplateData? {
    guard let initialDataJSON, !initialDataJSON.isEmpty else {
      return nil
    }

    return LynxTemplateData(json: initialDataJSON, useBoolLiterals: true)
  }

  private func consumeTemplateDataForLoad() -> LynxTemplateData? {
    initialDataNeedsUpdate = false
    return makeTemplateData()
  }

  private func applyPendingInitialDataUpdate() {
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

  private func eventPayload(for target: ExpoLynxLoadTarget) -> [String: Any] {
    [
      "url": target.url,
      "feature": target.feature,
      "version": target.version,
      "source": target.source,
      "durationMs": max(0, Int(Date().timeIntervalSince(loadStartedAt) * 1_000)),
    ]
  }

  private func currentLoadDurationMilliseconds() -> Int {
    max(0, Int(Date().timeIntervalSince(loadStartedAt) * 1_000))
  }

  private func emitDeliveryError(_ error: Error, fallbackURL: String, feature: String) {
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

  private func emitUpdate(_ payload: [String: Any]) {
    onUpdate(payload)
  }

  private func emitUpdateError(_ error: Error, feature: String) {
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

  private func emitError(
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
  private static func redactedEventMessage(_ message: String) -> String {
    let words = message.split(separator: " ", omittingEmptySubsequences: false).map { word -> String in
      let suffix = word.reversed().prefix { ").,]".contains($0) }
      let core = String(word.dropLast(suffix.count))
      guard var components = URLComponents(string: core), components.scheme != nil, components.host != nil else {
        return String(word)
      }
      components.query = nil
      components.user = nil
      components.password = nil
      return (components.string ?? core) + String(suffix.reversed())
    }
    return words.joined(separator: " ").prefix(500).description
  }

  private func startWatchdog(target: ExpoLynxLoadTarget, generation: Int) {
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

  private func failCandidate(
    _ target: ExpoLynxLoadTarget,
    error: Error,
    generation: Int
  ) {
    guard let manifestID = target.candidateManifestID,
      let feature = target.managedFeature
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
      feature: feature
    )
    let state = LynxManagedDeploymentState.shared.recover(feature: feature)
    if let activeID = state.activeReleaseID,
      activeID != manifestID,
      let active = LynxManagedBundleStore.shared.launchInstalledRelease(
        feature: feature,
        releaseID: activeID
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

  func lynxView(_ view: LynxView, didLoadFinishedWithUrl url: String) {
    guard let target = currentTarget else {
      hasLoadedTemplate = true
      applyPendingInitialDataUpdate()
      onLoad(["url": url])
      return
    }
    guard url.isEmpty || url == target.url else { return }
    hasLoadedTemplate = true
    currentLoadGate.recordLoadFinished()
    #if DEBUG
      let loadFinishedMilliseconds = currentLoadDurationMilliseconds()
      Self.performanceLogger.notice(
        "load_finished_ms=\(loadFinishedMilliseconds, privacy: .public) feature=\(target.feature, privacy: .public) source=\(target.source, privacy: .public)"
      )
    #endif
    applyPendingInitialDataUpdate()
    completeCurrentLoadHealthIfReady()
  }

  func lynxViewDidFirstScreen(_ view: LynxView) {
    guard let target = currentTarget, currentLoadGate.recordFirstScreen() else { return }

    let firstScreenMilliseconds = currentLoadDurationMilliseconds()
    #if DEBUG
      Self.performanceLogger.notice(
        "first_screen_ms=\(firstScreenMilliseconds, privacy: .public) feature=\(target.feature, privacy: .public) source=\(target.source, privacy: .public)"
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
      let feature = target.managedFeature
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
          feature: feature
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
