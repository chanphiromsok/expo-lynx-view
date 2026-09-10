import Foundation
import Lynx

final class ExpoLynxTemplateProvider: NSObject, LynxTemplateProvider,
  LynxTemplateResourceFetcher, LynxGenericResourceFetcher, LynxMediaResourceFetcher
{
  static let shared = ExpoLynxTemplateProvider()
  private let resourceRootLock = NSLock()
  // This provider's own root — set by the `ExpoLynxView` that owns this
  // instance. `.shared` (which backs prewarmed runtimes) never gets one; it
  // resolves entirely through `ExpoLynxResourceRoots` + the app bundle.
  private var preferredResourceRoot: URL?

  func setLocalResourceRoot(_ url: URL?) {
    resourceRootLock.lock()
    preferredResourceRoot = url
    resourceRootLock.unlock()
  }

  /// Ordered candidate roots: this provider's own root first (the per-view
  /// instance), then every root registered by a live view — the only source
  /// available to `.shared` — then the app bundle. `existingFileURL` /
  /// `existingResourceURL` still sandbox each candidate, so widening the set
  /// cannot escape a registered root.
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

  func bundledResourceURL(for value: String) -> URL? {
    let roots = candidateRoots()
    guard !roots.isEmpty else { return nil }

    if let fileURL = URL(string: value), fileURL.isFileURL {
      return roots.lazy.compactMap { self.existingFileURL(fileURL, inside: $0) }.first
    }

    guard let components = normalizedComponents(value) else { return nil }
    return roots.lazy.compactMap { self.existingResourceURL(root: $0, components: components) }.first
  }

  /// Strip a `bundle://` prefix, reject explicit schemes and `.` / `..`
  /// traversal, and split into path components. Logic unchanged from the
  /// previous inline implementation in `bundledResourceURL`.
  private func normalizedComponents(_ value: String) -> [Substring]? {
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
    return pathComponents
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

    guard candidate.path == normalizedRoot.path || candidate.path.hasPrefix(rootPath),
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
