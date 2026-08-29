import Foundation

struct LynxManagedRelease: Sendable {
  let feature: String
  let manifestID: String
  let version: String
  let bundleURL: URL
}

actor LynxManagedBundleStore {
  static let shared = LynxManagedBundleStore()

  private let fileManager = FileManager.default
  private let rootURL: URL

  init(rootURL: URL? = nil) {
    if let rootURL {
      self.rootURL = rootURL
    } else {
      let applicationSupport = FileManager.default.urls(
        for: .applicationSupportDirectory,
        in: .userDomainMask
      ).first!
      self.rootURL = applicationSupport.appendingPathComponent("ExpoLynx", isDirectory: true)
    }
  }

  func installedRelease(feature: String, manifestID: String) throws -> LynxManagedRelease? {
    guard isSafeFeature(feature), isSHA256(manifestID) else { return nil }
    let releaseURL = readyURL(feature: feature, manifestID: manifestID)
    let manifestURL = releaseURL.appendingPathComponent("manifest.json")
    let bundleURL = releaseURL.appendingPathComponent("main.lynx.bundle")
    // This is the hot path used when reopening a cached release. Full byte
    // hashing is intentionally install-only; doing it here would reread the
    // bundle and every sidecar before Lynx can render. Keep only cheap
    // structural checks. If bytes are damaged after installation, Lynx should
    // report the load error rather than making every healthy launch reread the
    // entire release before rendering.
    guard isRegularFile(manifestURL), isRegularFile(bundleURL)
    else { return nil }

    let manifestData = try Data(contentsOf: manifestURL)
    guard LynxManagedManifest.manifestID(for: manifestData) == manifestID else { return nil }
    let manifest = try LynxManagedManifest.decode(manifestData, expectedFeature: feature)
    for resource in manifest.resources {
      let resourceURL = releaseURL.appendingPathComponent(resource.path)
      guard isRegularFile(resourceURL) else { return nil }
    }

    return LynxManagedRelease(
      feature: feature,
      manifestID: manifestID,
      version: manifest.version,
      bundleURL: bundleURL
    )
  }

  func install(manifestURL: URL, expectedFeature: String) async throws -> LynxManagedRelease {
    let (manifestData, response) = try await URLSession.shared.data(for: noCacheURLRequest(manifestURL))
    try validateHTTPResponse(response, url: manifestURL)
    guard !manifestData.isEmpty else {
      throw LynxDeliveryError(
        stage: .manifest,
        code: "ERR_LYNX_MANIFEST_EMPTY",
        message: "The Lynx release manifest response was empty."
      )
    }

    let manifest = try LynxManagedManifest.decode(manifestData, expectedFeature: expectedFeature)
    let manifestID = LynxManagedManifest.manifestID(for: manifestData)
    if let installed = try installedRelease(feature: expectedFeature, manifestID: manifestID) {
      return installed
    }

    let featureRoot = rootURL.appendingPathComponent(expectedFeature, isDirectory: true)
    let stagingRoot = featureRoot.appendingPathComponent("staging", isDirectory: true)
    let stagingURL = stagingRoot.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try fileManager.createDirectory(at: stagingURL, withIntermediateDirectories: true)
    defer { try? fileManager.removeItem(at: stagingURL) }

    let bundleDestination = stagingURL.appendingPathComponent("main.lynx.bundle")
    try await download(
      from: try resolveRemoteURL(manifest.bundle.url, relativeTo: manifestURL),
      to: bundleDestination,
      expectedBytes: manifest.bundle.bytes,
      expectedHash: manifest.bundle.sha256
    )

    for resource in manifest.resources {
      let destination = stagingURL.appendingPathComponent(resource.path)
      try await download(
        from: try resolveRemoteURL(resource.url, relativeTo: manifestURL),
        to: destination,
        expectedBytes: resource.bytes,
        expectedHash: resource.sha256
      )
    }

    try manifestData.write(
      to: stagingURL.appendingPathComponent("manifest.json"),
      options: .atomic
    )

    let finalURL = readyURL(feature: expectedFeature, manifestID: manifestID)
    try fileManager.createDirectory(
      at: finalURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    if !fileManager.fileExists(atPath: finalURL.path) {
      try fileManager.moveItem(at: stagingURL, to: finalURL)
    }

    guard let installed = try installedRelease(feature: expectedFeature, manifestID: manifestID) else {
      throw LynxDeliveryError(
        stage: .resource,
        code: "ERR_LYNX_RELEASE_INSTALL",
        message: "The downloaded Lynx release could not be reopened after installation."
      )
    }
    return installed
  }

  private func readyURL(feature: String, manifestID: String) -> URL {
    rootURL
      .appendingPathComponent(feature, isDirectory: true)
      .appendingPathComponent("ready", isDirectory: true)
      .appendingPathComponent(manifestID, isDirectory: true)
  }

  private func isRegularFile(_ url: URL) -> Bool {
    guard fileManager.fileExists(atPath: url.path) else { return false }
    guard let values = try? url.resourceValues(forKeys: [.isDirectoryKey]) else { return false }
    return values.isDirectory != true
  }

  private func isSafeFeature(_ feature: String) -> Bool {
    guard !feature.isEmpty, feature.count <= 100 else { return false }
    return feature.unicodeScalars.allSatisfy {
      CharacterSet.alphanumerics.contains($0) || "-_.".unicodeScalars.contains($0)
    }
  }

  private func isSHA256(_ value: String) -> Bool {
    let characters = CharacterSet(charactersIn: "0123456789abcdefABCDEF")
    return value.count == 64 && value.unicodeScalars.allSatisfy { characters.contains($0) }
  }

  private func download(
    from remoteURL: URL,
    to destinationURL: URL,
    expectedBytes: Int64,
    expectedHash: String
  ) async throws {
    let (temporaryURL, response) = try await URLSession.shared.download(
      for: noCacheURLRequest(remoteURL)
    )
    try validateHTTPResponse(response, url: remoteURL)
    try fileManager.createDirectory(
      at: destinationURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try fileManager.copyItem(at: temporaryURL, to: destinationURL)
    try verify(url: destinationURL, expectedBytes: expectedBytes, expectedHash: expectedHash)
  }

  private func verify(url: URL, expectedBytes: Int64, expectedHash: String) throws {
    guard let values = try? url.resourceValues(forKeys: [.fileSizeKey]),
      Int64(values.fileSize ?? -1) == expectedBytes
    else {
      throw LynxDeliveryError(
        stage: .checksum,
        code: "ERR_LYNX_SIZE_MISMATCH",
        message: "The downloaded file size does not match the release manifest for \(url.lastPathComponent)."
      )
    }
    let actualHash = try LynxManagedManifest.sha256(of: url)
    guard actualHash.caseInsensitiveCompare(expectedHash) == .orderedSame else {
      throw LynxDeliveryError(
        stage: .checksum,
        code: "ERR_LYNX_SHA256_MISMATCH",
        message: "The downloaded SHA-256 does not match the release manifest for \(url.lastPathComponent)."
      )
    }
  }

  private func noCacheURLRequest(_ url: URL) -> URLRequest {
    var request = URLRequest(url: url)
    // A development phone can leave the LAN or lose Wi-Fi while a release is
    // being fetched. Bound every manifest, bundle, and resource request so a
    // managed load can surface an error and reveal the embedded fallback
    // instead of leaving the host splash visible forever.
    request.timeoutInterval = 15
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
    return request
  }

  private func resolveRemoteURL(_ value: String, relativeTo manifestURL: URL) throws -> URL {
    guard let url = URL(string: value, relativeTo: manifestURL)?.absoluteURL,
      let scheme = url.scheme?.lowercased(),
      scheme == "http" || scheme == "https"
    else {
      throw LynxDeliveryError(
        stage: .manifest,
        code: "ERR_LYNX_FILE_URL",
        message: "A Lynx release file URL could not be resolved: \(value)"
      )
    }
    return url
  }

  private func validateHTTPResponse(_ response: URLResponse, url: URL) throws {
    guard let response = response as? HTTPURLResponse,
      (200...299).contains(response.statusCode)
    else {
      let status = (response as? HTTPURLResponse)?.statusCode ?? 0
      throw LynxDeliveryError(
        stage: .download,
        code: "ERR_LYNX_HTTP_\(status)",
        message: "The Lynx release request failed for \(url.absoluteString) (HTTP \(status))."
      )
    }
  }
}
