import ExpoModulesCore
import Lynx

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
  let channel: String?
  let activation: String?
  let manifestUrl: String?
  let url: String?
}

private struct ExpoLynxManagedContext {
  let feature: String
  let channel: String
  let activation: String
  let manifestURL: URL?
}

private struct ExpoLynxLoadTarget {
  let url: String
  let feature: String
  let version: String
  let source: String
  let managedContext: ExpoLynxManagedContext?
  let candidateManifestID: String?
}

final class ExpoLynxView: ExpoView, LynxViewLifecycle {
  let onLoadStart = EventDispatcher()
  let onLoad = EventDispatcher()
  let onError = EventDispatcher()

  private let lynxView: LynxView
  private let templateProvider: ExpoLynxTemplateProvider
  private var legacySource: String?
  private var sourceJSON: String?
  private var source = ""
  private var initialDataJSON: String?
  private var loadGeneration = 0
  private var hasLoadedTemplate = false
  private var lastLayoutSize = CGSize.zero
  private var lastSafeAreaInsets: UIEdgeInsets?
  private var hasPendingUpdate = false
  private var currentTarget: ExpoLynxLoadTarget?
  private var deliveryTask: Task<Void, Never>?
  private var watchdogWorkItem: DispatchWorkItem?
  private var loadStartedAt = Date()

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
    hasPendingUpdate = true
  }

  func setSourceJSON(_ value: String?) {
    guard value != sourceJSON else {
      return
    }

    sourceJSON = value
    hasPendingUpdate = true
  }

  func setInitialDataJSON(_ value: String?) {
    guard value != initialDataJSON else {
      return
    }

    initialDataJSON = value
    hasPendingUpdate = true

    if hasLoadedTemplate, let templateData = makeTemplateData() {
      lynxView.updateData(with: templateData)
    }
  }

  func applyPendingUpdate() {
    guard hasPendingUpdate else {
      return
    }
    hasPendingUpdate = false
    scheduleLoad()
  }

  func reload() {
    scheduleLoad()
  }

  private func scheduleLoad() {
    loadGeneration += 1
    hasLoadedTemplate = false
    deliveryTask?.cancel()
    watchdogWorkItem?.cancel()
    currentTarget = nil

    let generation = loadGeneration
    DispatchQueue.main.async { [weak self] in
      guard let self, generation == self.loadGeneration else {
        return
      }
      self.loadSource(generation: generation)
    }
  }

  private func loadSource(generation: Int) {
    if let sourceJSON, !sourceJSON.isEmpty {
      do {
        let payload = try JSONDecoder().decode(
          ExpoLynxSourcePayload.self,
          from: Data(sourceJSON.utf8)
        )
        switch payload.kind {
        case "embedded":
          loadEmbedded(feature: payload.feature ?? "default", generation: generation)
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
      } catch {
        emitError(
          url: "",
          feature: "",
          stage: .manifest,
          code: "ERR_LYNX_SOURCE_INVALID",
          message: "Could not decode the Lynx source configuration: \(error.localizedDescription)"
        )
      }
      return
    }

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
            managedContext: nil,
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
          managedContext: nil,
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
    let embeddedName = resolveLocalURL("\(feature).lynx") == nil ? "static.lynx" : "\(feature).lynx"
    loadTarget(
      ExpoLynxLoadTarget(
        url: embeddedName,
        feature: feature,
        version: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
          ?? "embedded",
        source: "embedded",
        managedContext: nil,
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
        url: payload.manifestUrl ?? "",
        feature: "",
        stage: .manifest,
        code: "ERR_LYNX_MANAGED_FEATURE",
        message: "A managed Lynx source requires a feature name."
      )
      return
    }

    let channel = payload.channel ?? "stable"
    let activation = payload.activation ?? "next-open"
    guard ["stable", "beta"].contains(channel),
      ["next-open", "on-launch"].contains(activation)
    else {
      emitError(
        url: payload.manifestUrl ?? "",
        feature: feature,
        stage: .manifest,
        code: "ERR_LYNX_MANAGED_OPTIONS",
        message: "The managed Lynx channel or activation mode is invalid."
      )
      return
    }

    let context = ExpoLynxManagedContext(
      feature: feature,
      channel: channel,
      activation: activation,
      manifestURL: payload.manifestUrl.flatMap(URL.init(string:))
    )
    if payload.manifestUrl != nil,
      !["http", "https"].contains(context.manifestURL?.scheme?.lowercased())
    {
      emitError(
        url: payload.manifestUrl ?? "",
        feature: feature,
        stage: .manifest,
        code: "ERR_LYNX_MANIFEST_URL",
        message: "The Debug manifest URL must use HTTP or HTTPS."
      )
      return
    }

    #if !DEBUG && LYNX_ALLOW_LOCAL_MANAGED_RELEASE
      // This switch affects transport only: even an internal Release build
      // still requires the embedded RSA public key and a valid signed release
      // envelope. It exists solely because ATS normally blocks HTTP LAN URLs.
    #endif

    deliveryTask = Task { @MainActor [weak self] in
      guard let self, generation == self.loadGeneration else { return }
      let state = await LynxManagedChannelState.shared.recover(feature: feature, channel: channel)

      var displayedManifestID: String?
      if let pendingID = state.pendingManifestID,
        let pending = try? await LynxManagedBundleStore.shared.installedRelease(
          feature: feature,
          manifestID: pendingID
        )
      {
        await LynxManagedChannelState.shared.beginAttempt(
          manifestID: pendingID,
          feature: feature,
          channel: channel
        )
        displayedManifestID = pendingID
        self.loadManagedRelease(
          pending,
          context: context,
          candidate: true,
          downloaded: false,
          generation: generation
        )
      } else if let activeID = state.activeManifestID,
        let active = try? await LynxManagedBundleStore.shared.installedRelease(
          feature: feature,
          manifestID: activeID
        )
      {
        displayedManifestID = activeID
        self.loadManagedRelease(
          active,
          context: context,
          candidate: false,
          downloaded: false,
          generation: generation
        )
      } else {
        self.loadEmbedded(feature: feature, generation: generation)
      }

      guard !Task.isCancelled, generation == self.loadGeneration else { return }
      guard let manifestURL = context.manifestURL else {
        self.emitError(
          url: "",
          feature: feature,
          stage: .manifest,
          code: "ERR_LYNX_MANIFEST_URL_REQUIRED",
          message: "A managed Lynx source requires a manifest URL to check for releases."
        )
        return
      }

      do {
        let release = try await LynxManagedBundleStore.shared.install(
          releaseEnvelopeURL: manifestURL,
          expectedFeature: feature
        )
        guard !Task.isCancelled, generation == self.loadGeneration,
          release.manifestID != displayedManifestID
        else { return }
        guard !(await LynxManagedChannelState.shared.isFailed(
          manifestID: release.manifestID,
          feature: feature,
          channel: channel
        )) else { return }

        if activation == "on-launch" {
          await LynxManagedChannelState.shared.beginAttempt(
            manifestID: release.manifestID,
            feature: feature,
            channel: channel
          )
          self.loadManagedRelease(
            release,
            context: context,
            candidate: true,
            downloaded: true,
            generation: generation
          )
        } else {
          await LynxManagedChannelState.shared.stage(
            manifestID: release.manifestID,
            feature: feature,
            channel: channel
          )
        }
      } catch is CancellationError {
        return
      } catch {
        self.emitDeliveryError(error, fallbackURL: manifestURL.absoluteString, feature: feature)
      }
    }
  }

  private func loadManagedRelease(
    _ release: LynxManagedRelease,
    context: ExpoLynxManagedContext,
    candidate: Bool,
    downloaded: Bool,
    generation: Int
  ) {
    loadTarget(
      ExpoLynxLoadTarget(
        url: release.bundleURL.absoluteString,
        feature: release.feature,
        version: release.version,
        source: downloaded ? "download" : "cache",
        managedContext: context,
        candidateManifestID: candidate ? release.manifestID : nil
      ),
      generation: generation
    )
  }

  private func loadTarget(_ target: ExpoLynxLoadTarget, generation: Int) {
    guard generation == loadGeneration else { return }
    source = target.url
    currentTarget = target
    loadStartedAt = Date()
    if ["cache", "download"].contains(target.source),
      let bundleURL = URL(string: target.url), bundleURL.isFileURL
    {
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
      lynxView.loadTemplate(fromURL: remoteURL.absoluteString, initData: makeTemplateData())
      return
    }

    guard let localURL = resolveLocalURL(target.url) else {
      lynxView.isHidden = true
      emitError(
        url: target.url,
        feature: target.feature,
        stage: .resource,
        code: "ERR_LYNX_SOURCE_NOT_FOUND",
        message: "Could not find the Lynx bundle in the app bundle or at the supplied file URL."
      )
      return
    }

    loadLocalURL(localURL, target: target, generation: generation)
    if target.candidateManifestID != nil {
      startWatchdog(target: target, generation: generation)
    }
  }

  private func loadLocalURL(_ url: URL, target: ExpoLynxLoadTarget, generation: Int) {
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      do {
        let data = try Data(contentsOf: url, options: .mappedIfSafe)
        self?.render(data, target: target, generation: generation)
      } catch {
        self?.finishWithError(error, target: target, generation: generation)
      }
    }
  }

  private func render(_ data: Data, target: ExpoLynxLoadTarget, generation: Int) {
    DispatchQueue.main.async { [weak self] in
      guard let self, generation == self.loadGeneration, target.url == self.source else {
        return
      }

      self.lynxView.loadTemplate(data, withURL: target.url, initData: self.makeTemplateData())
    }
  }

  private func finishWithError(_ error: Error, target: ExpoLynxLoadTarget, generation: Int) {
    DispatchQueue.main.async { [weak self] in
      guard let self, generation == self.loadGeneration else {
        return
      }

      if target.candidateManifestID != nil {
        self.failCandidate(target, error: error, generation: generation)
        return
      }

      // ponytail: hide the previous render so a failed reload doesn't
      // show the stale bundle. The engine keeps its internal state, but
      // the visible pixels are gone. The next successful load un-hides
      // via loadSource's setSource path.
      self.lynxView.isHidden = true

      let payload = ExpoLynxView.errorPayload(for: error, fallbackURL: target.url)
      self.emitError(
        url: target.url,
        feature: target.feature,
        stage: .lynx,
        code: payload.code,
        message: payload.message
      )
    }
  }

  private static func errorPayload(for error: Error, fallbackURL: String) -> (
    code: String, message: String
  ) {
    let nsError = error as NSError
    let info = nsError.userInfo

    if let underlying = info[NSUnderlyingErrorKey] as? NSError {
      let nested = errorPayload(for: underlying, fallbackURL: fallbackURL)
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

  private func eventPayload(for target: ExpoLynxLoadTarget) -> [String: Any] {
    [
      "url": target.url,
      "feature": target.feature,
      "version": target.version,
      "source": target.source,
      "durationMs": max(0, Int(Date().timeIntervalSince(loadStartedAt) * 1_000)),
    ]
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

    let payload = ExpoLynxView.errorPayload(for: error, fallbackURL: fallbackURL)
    emitError(
      url: fallbackURL,
      feature: feature,
      stage: .download,
      code: payload.code,
      message: payload.message
    )
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
      "message": message,
    ])
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
      let context = target.managedContext
    else { return }

    watchdogWorkItem?.cancel()
    emitDeliveryError(error, fallbackURL: target.url, feature: target.feature)

    deliveryTask?.cancel()
    deliveryTask = Task { @MainActor [weak self] in
      guard let self, generation == self.loadGeneration else { return }
      await LynxManagedChannelState.shared.fail(
        manifestID: manifestID,
        feature: context.feature,
        channel: context.channel
      )
      let state = await LynxManagedChannelState.shared.recover(
        feature: context.feature,
        channel: context.channel
      )
      if let activeID = state.activeManifestID,
        activeID != manifestID,
        let active = try? await LynxManagedBundleStore.shared.installedRelease(
          feature: context.feature,
          manifestID: activeID
        )
      {
        self.loadManagedRelease(
          active,
          context: context,
          candidate: false,
          downloaded: false,
          generation: generation
        )
      } else {
        self.loadEmbedded(feature: context.feature, generation: generation)
      }
    }
  }

  func lynxView(_ view: LynxView, didLoadFinishedWithUrl url: String) {
    guard let target = currentTarget else {
      hasLoadedTemplate = true
      onLoad(["url": url])
      return
    }
    guard url.isEmpty || url == target.url else { return }
    watchdogWorkItem?.cancel()
    hasLoadedTemplate = true

    var payload = eventPayload(for: target)
    payload["durationMs"] = max(0, Int(Date().timeIntervalSince(loadStartedAt) * 1_000))
    onLoad(payload)

    if let manifestID = target.candidateManifestID,
      let context = target.managedContext
    {
      Task {
        await LynxManagedChannelState.shared.confirm(
          manifestID: manifestID,
          feature: context.feature,
          channel: context.channel
        )
      }
    }
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

    let payload = ExpoLynxView.errorPayload(for: error, fallbackURL: view.url ?? source)
    emitError(
      url: view.url ?? source,
      feature: target?.feature ?? "",
      stage: .lynx,
      code: payload.code,
      message: payload.message
    )
  }
}
