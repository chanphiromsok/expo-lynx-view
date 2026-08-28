import ExpoModulesCore
import Lynx

final class ExpoLynxTemplateProvider: NSObject, LynxTemplateProvider,
  LynxTemplateResourceFetcher, LynxGenericResourceFetcher, LynxMediaResourceFetcher
{
  static let shared = ExpoLynxTemplateProvider()

  func bundledResourceURL(for value: String) -> URL? {
    if let fileURL = URL(string: value), fileURL.isFileURL,
      FileManager.default.fileExists(atPath: fileURL.path)
    {
      return fileURL
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
      !pathComponents.contains(where: { $0 == "." || $0 == ".." }),
      let resourceRoot = Bundle.main.resourceURL
    else {
      return nil
    }

    let normalizedRoot = resourceRoot.standardizedFileURL
    let candidate = pathComponents.reduce(normalizedRoot) { partialURL, component in
      partialURL.appendingPathComponent(String(component), isDirectory: false)
    }.standardizedFileURL
    let rootPath = normalizedRoot.path.hasSuffix("/") ? normalizedRoot.path : normalizedRoot.path + "/"

    guard candidate.path.hasPrefix(rootPath),
      FileManager.default.fileExists(atPath: candidate.path)
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

final class ExpoLynxView: ExpoView, LynxViewLifecycle {
  let onLoadStart = EventDispatcher()
  let onLoad = EventDispatcher()
  let onError = EventDispatcher()

  private let lynxView: LynxView
  private let templateProvider: ExpoLynxTemplateProvider
  private var source = ""
  private var initialDataJSON: String?
  private var loadGeneration = 0
  private var hasLoadedTemplate = false
  private var lastLayoutSize = CGSize.zero
  private var lastSafeAreaInsets: UIEdgeInsets?
  private var hasPendingUpdate = false

  required init(appContext: AppContext? = nil) {
    // Do not set screen metrics here. Lynx 4 marks screen-metric updates as
    // experimental and does not support multiple views with different metrics.
    // The per-view viewport is updated from this view's bounds in applyLayout.
    let provider = ExpoLynxTemplateProvider.shared
    templateProvider = provider
    lynxView = LynxView { builder in
      // Match Lynx Explorer: each view gets a config backed by the provider
      // prepared on LynxEnv, while the fetcher handles remote URL reloads.
      builder.config = LynxConfig(
        provider: LynxEnv.sharedInstance().config.templateProvider
      )
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
    lynxView.updateGlobalProps([
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

  func setSource(_ value: String) {
    let nextSource = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard nextSource != source else {
      return
    }

    source = nextSource
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

    let generation = loadGeneration
    DispatchQueue.main.async { [weak self] in
      guard let self, generation == self.loadGeneration else {
        return
      }
      self.loadSource(generation: generation)
    }
  }

  private func loadSource(generation: Int) {
    guard !source.isEmpty else {
      return
    }

    onLoadStart(["url": source])
    // ponytail: show the new template as soon as a load starts; if it
    // fails, finishWithError hides it again so the stale render isn't
    // left on screen. The engine has no public wipe-but-stay-alive API;
    // `isHidden` is the only safe way to drop visibility.
    lynxView.isHidden = false

    if let remoteURL = URL(string: source),
      ["http", "https"].contains(remoteURL.scheme?.lowercased())
    {
      // Match Lynx Explorer: let Lynx own the remote load so DevTool's
      // Page.reload uses the same template-resource-fetcher pipeline.
      lynxView.loadTemplate(fromURL: remoteURL.absoluteString, initData: makeTemplateData())
      return
    }

    guard let localURL = resolveLocalURL(source) else {
      lynxView.isHidden = true
      emitError(
        url: source,
        code: "ERR_LYNX_SOURCE_NOT_FOUND",
        message: "Could not find the Lynx bundle in the app bundle or at the supplied file URL."
      )
      return
    }

    loadLocalURL(localURL, generation: generation)
  }

  private func loadLocalURL(_ url: URL, generation: Int) {
    let requestedSource = source
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      do {
        let data = try Data(contentsOf: url, options: .mappedIfSafe)
        self?.render(data, source: requestedSource, generation: generation)
      } catch {
        self?.finishWithError(error, source: requestedSource, generation: generation)
      }
    }
  }

  private func render(_ data: Data, source: String, generation: Int) {
    DispatchQueue.main.async { [weak self] in
      guard let self, generation == self.loadGeneration, source == self.source else {
        return
      }

      self.lynxView.loadTemplate(data, withURL: source, initData: self.makeTemplateData())
    }
  }

  private func finishWithError(_ error: Error, source: String, generation: Int) {
    DispatchQueue.main.async { [weak self] in
      guard let self, generation == self.loadGeneration else {
        return
      }

      // ponytail: hide the previous render so a failed reload doesn't
      // show the stale bundle. The engine keeps its internal state, but
      // the visible pixels are gone. The next successful load un-hides
      // via loadSource's setSource path.
      self.lynxView.isHidden = true

      let payload = ExpoLynxView.errorPayload(for: error, fallbackURL: source)
      self.emitError(
        url: source,
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

    let normalizedName = value.hasPrefix("bundle://")
      ? String(value.dropFirst("bundle://".count)) : value
    return Bundle.main.url(forResource: normalizedName, withExtension: "bundle")
  }

  private func makeTemplateData() -> LynxTemplateData? {
    guard let initialDataJSON, !initialDataJSON.isEmpty else {
      return nil
    }

    return LynxTemplateData(json: initialDataJSON, useBoolLiterals: true)
  }

  private func emitError(url: String, code: String, message: String) {
    onError([
      "url": url,
      "code": code,
      "message": message,
    ])
  }

  func lynxView(_ view: LynxView, didLoadFinishedWithUrl url: String) {
    hasLoadedTemplate = true
    onLoad(["url": url])
  }

  func lynxView(_ view: LynxView, didRecieveError error: Error) {
    if ExpoLynxView.isMainBundleError(error) {
      view.isHidden = true
    }

    let payload = ExpoLynxView.errorPayload(for: error, fallbackURL: view.url ?? source)
    emitError(
      url: view.url ?? source,
      code: payload.code,
      message: payload.message
    )
  }
}
