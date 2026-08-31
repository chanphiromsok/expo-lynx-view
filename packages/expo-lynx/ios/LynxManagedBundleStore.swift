import CryptoKit
import Foundation

struct LynxManagedRelease: Sendable {
  let feature: String
  let manifestID: String
  let version: String
  let bundleURL: URL
}

enum LynxDeploymentUpdateResult: Sendable {
  case notModified(eTag: String?)
  case disabled(eTag: String?, revision: Int)
  case blocked(releaseID: String, eTag: String?, revision: Int)
  case selected(
    release: LynxManagedRelease,
    force: Bool,
    eTag: String?,
    revision: Int,
    downloaded: Bool
  )
}

actor LynxManagedBundleStore {
  static let shared = LynxManagedBundleStore()

  private let fileManager = FileManager.default
  private let rootURL: URL
  private var v2Installs: [String: Task<LynxManagedRelease, Error>] = [:]
  private var deploymentChecks: [String: Task<LynxDeploymentUpdateResult, Error>] = [:]

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

  func installedRelease(
    feature: String,
    manifestID: String
  ) throws -> LynxManagedRelease? {
    guard isSafeFeature(feature) else { return nil }
    // V2 release IDs are opaque signed identifiers, not legacy manifest
    // hashes. Prefer the V2 completion marker before considering the legacy
    // manifest layout so a staged signed release can reopen cheaply.
    if let installed = try installedV2Release(
      feature: feature,
      releaseID: manifestID
    ) {
      return installed
    }
    guard isSHA256(manifestID) else { return nil }
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

  /// V2 accepts only an exact signed release envelope. Its archive is never
  /// trusted until RSA verification, central-directory validation, extraction,
  /// and per-file hashes have succeeded in an app-private transaction.
  func install(
    releaseEnvelopeURL: URL,
    expectedFeature: String
  ) async throws -> LynxManagedRelease {
    let (envelope, response) = try await URLSession.shared.data(for: noCacheURLRequest(releaseEnvelopeURL))
    try validateHTTPResponse(response, url: releaseEnvelopeURL)
    return try await install(
      releaseEnvelopeData: envelope,
      releaseEnvelopeURL: releaseEnvelopeURL,
      expectedFeature: expectedFeature
    )
  }

  /// Installation still owns the expensive cryptographic, archive, and file
  /// verification. Deployment checks call this only after a signed pointer has
  /// identified a different immutable release.
  func install(
    releaseEnvelopeData: Data,
    releaseEnvelopeURL: URL,
    expectedFeature: String
  ) async throws -> LynxManagedRelease {
    let payload = try LynxReleasePayload.decodeVerified(
      LynxSignatureVerifier.verifyEmbedded(envelopeData: releaseEnvelopeData, expectedType: "lynx-release", expectedFeature: expectedFeature),
      expectedFeature: expectedFeature
    )
    let key = "\(expectedFeature)/\(payload.releaseId)"
    if let installed = try installedV2Release(feature: expectedFeature, releaseID: payload.releaseId) { return installed }
    if let task = v2Installs[key] { return try await task.value }
    let task = Task { [self] in
      try await performV2Install(
        payload: payload,
        envelope: releaseEnvelopeData,
        envelopeURL: releaseEnvelopeURL
      )
    }
    v2Installs[key] = task
    defer { v2Installs[key] = nil }
    return try await task.value
  }

  /// Reads the small signed deployment envelope with ETag and revision replay
  /// protection. Artifact bytes are requested only for a new, unblocked ID.
  func checkForUpdate(
    deploymentEnvelopeURL: URL,
    expectedFeature: String,
    eTag: String?,
    lastRevision: Int?,
    blockedReleaseIDs: Set<String>
  ) async throws -> LynxDeploymentUpdateResult {
    let key = "\(expectedFeature)/\(deploymentEnvelopeURL.absoluteString)"
    if let task = deploymentChecks[key] { return try await task.value }
    let task = Task { [self] in
      try await performDeploymentCheck(
        deploymentEnvelopeURL: deploymentEnvelopeURL,
        expectedFeature: expectedFeature,
        eTag: eTag,
        lastRevision: lastRevision,
        blockedReleaseIDs: blockedReleaseIDs
      )
    }
    deploymentChecks[key] = task
    defer { deploymentChecks[key] = nil }
    return try await task.value
  }

  private func performDeploymentCheck(
    deploymentEnvelopeURL: URL,
    expectedFeature: String,
    eTag: String?,
    lastRevision: Int?,
    blockedReleaseIDs: Set<String>
  ) async throws -> LynxDeploymentUpdateResult {
    var request = noCacheURLRequest(deploymentEnvelopeURL)
    if let eTag, !eTag.isEmpty { request.setValue(eTag, forHTTPHeaderField: "If-None-Match") }
    let (deploymentEnvelope, response) = try await URLSession.shared.data(for: request)
    guard let httpResponse = response as? HTTPURLResponse else {
      throw LynxDeliveryError(stage: .download, code: "ERR_LYNX_HTTP_0", message: "The Lynx deployment response was not HTTP.")
    }
    if httpResponse.statusCode == 304 {
      return .notModified(eTag: httpResponse.value(forHTTPHeaderField: "ETag") ?? eTag)
    }
    try validateHTTPResponse(httpResponse, url: deploymentEnvelopeURL)
    let deployment = try LynxDeploymentPayload.decodeVerified(
      LynxSignatureVerifier.verifyEmbedded(
        envelopeData: deploymentEnvelope,
        expectedType: "lynx-deployment",
        expectedFeature: expectedFeature
      ),
      expectedFeature: expectedFeature
    )
    let responseETag = httpResponse.value(forHTTPHeaderField: "ETag")
    if let lastRevision {
      guard deployment.revision >= lastRevision else {
        throw LynxDeliveryError(
          stage: .manifest,
          code: "ERR_LYNX_DEPLOYMENT_REPLAY",
          message: "The signed deployment revision is older than local state."
        )
      }
      if deployment.revision == lastRevision {
        guard let eTag, responseETag == eTag else {
          throw LynxDeliveryError(
            stage: .manifest,
            code: "ERR_LYNX_DEPLOYMENT_CONFLICT",
            message: "The signed deployment changed without a newer revision."
          )
        }
        return .notModified(eTag: responseETag)
      }
    }

    guard deployment.enabled else {
      return .disabled(eTag: responseETag, revision: deployment.revision)
    }
    guard let releaseID = deployment.releaseId,
      let manifestURL = deployment.manifestUrl,
      let manifestSha256 = deployment.manifestSha256,
      let force = deployment.force
    else {
      throw LynxDeliveryError(
        stage: .manifest,
        code: "ERR_LYNX_DEPLOYMENT_INVALID",
        message: "The enabled deployment is missing release fields."
      )
    }
    if blockedReleaseIDs.contains(releaseID) {
      return .blocked(
        releaseID: releaseID,
        eTag: responseETag,
        revision: deployment.revision
      )
    }
    if let installed = try installedV2Release(feature: expectedFeature, releaseID: releaseID) {
      return .selected(
        release: installed,
        force: force,
        eTag: responseETag,
        revision: deployment.revision,
        downloaded: false
      )
    }

    let releaseEnvelopeURL = try resolveRemoteURL(manifestURL, relativeTo: deploymentEnvelopeURL)
    let (releaseEnvelope, releaseResponse) = try await URLSession.shared.data(
      for: noCacheURLRequest(releaseEnvelopeURL)
    )
    try validateHTTPResponse(releaseResponse, url: releaseEnvelopeURL)
    let releaseHash = SHA256.hash(data: releaseEnvelope).map { String(format: "%02x", $0) }.joined()
    guard releaseHash == manifestSha256 else {
      throw LynxDeliveryError(
        stage: .checksum,
        code: "ERR_LYNX_DEPLOYMENT_MANIFEST_SHA256",
        message: "The release envelope does not match the signed deployment."
      )
    }
    let release = try await install(
      releaseEnvelopeData: releaseEnvelope,
      releaseEnvelopeURL: releaseEnvelopeURL,
      expectedFeature: expectedFeature
    )
    guard release.manifestID == releaseID else {
      throw LynxDeliveryError(
        stage: .manifest,
        code: "ERR_LYNX_DEPLOYMENT_RELEASE_ID",
        message: "The signed deployment release ID does not match the signed release envelope."
      )
    }
    return .selected(
      release: release,
      force: force,
      eTag: responseETag,
      revision: deployment.revision,
      downloaded: true
    )
  }

  private func performV2Install(
    payload: LynxReleasePayload,
    envelope: Data,
    envelopeURL: URL
  ) async throws -> LynxManagedRelease {
    try ensureDiskSpace(requiredBytes: payload.archive.bytes + payload.archive.uncompressedBytes)
    let featureRoot = featureRoot(feature: payload.feature)
    let staging = featureRoot.appendingPathComponent("staging", isDirectory: true).appendingPathComponent(UUID().uuidString, isDirectory: true)
    let extracted = staging.appendingPathComponent("release", isDirectory: true)
    let archive = staging.appendingPathComponent("release.zip.part")
    try fileManager.createDirectory(at: staging, withIntermediateDirectories: true)
    defer { try? fileManager.removeItem(at: staging) }
    try await download(from: try resolveRemoteURL(payload.archive.url, relativeTo: envelopeURL), to: archive, expectedBytes: payload.archive.bytes, expectedHash: payload.archive.sha256)
    let expected = payload.files.map { LynxArchiveExpectedFile(path: $0.path, bytes: $0.bytes, sha256: $0.sha256) }
    try LynxSafeArchive.extract(archiveURL: archive, to: extracted, expectedFiles: expected)
    for file in expected { try verify(url: extracted.appendingPathComponent(file.path), expectedBytes: file.bytes, expectedHash: file.sha256) }
    try envelope.write(to: extracted.appendingPathComponent("release-envelope.json"), options: .atomic)
    let completion = V2Completion(feature: payload.feature, releaseID: payload.releaseId, version: payload.version, archiveSHA256: payload.archive.sha256, files: expected.map(\.path))
    try JSONEncoder().encode(completion).write(to: extracted.appendingPathComponent("completion.json"), options: .atomic)
    let final = v2ReadyURL(feature: payload.feature, releaseID: payload.releaseId)
    try fileManager.createDirectory(at: final.deletingLastPathComponent(), withIntermediateDirectories: true)
    if !fileManager.fileExists(atPath: final.path) { try fileManager.moveItem(at: extracted, to: final) }
    guard let installed = try installedV2Release(feature: payload.feature, releaseID: payload.releaseId) else { throw LynxDeliveryError(stage: .archive, code: "ERR_LYNX_RELEASE_INSTALL", message: "The completed signed Lynx release could not be reopened.") }
    return installed
  }

  private func installedV2Release(feature: String, releaseID: String) throws -> LynxManagedRelease? {
    guard isSafeFeature(feature), releaseID.range(of: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$", options: .regularExpression) != nil else { return nil }
    let directory = v2ReadyURL(feature: feature, releaseID: releaseID)
    let completionURL = directory.appendingPathComponent("completion.json")
    let bundleURL = directory.appendingPathComponent("main.lynx.bundle")
    if !isRegularFile(completionURL), try migrateLegacyV2Release(feature: feature, releaseID: releaseID) {
      return try installedV2Release(feature: feature, releaseID: releaseID)
    }
    guard isRegularFile(completionURL), isRegularFile(bundleURL), let completion = try? JSONDecoder().decode(V2Completion.self, from: Data(contentsOf: completionURL)), completion.feature == feature, completion.releaseID == releaseID else { return nil }
    // Cache opens perform only bounded metadata/entry checks. Archive, RSA,
    // CRC, and file-hash verification are install-time work and are never
    // repeated for a healthy completed directory.
    for path in completion.files ?? ["main.lynx.bundle"] {
      guard isRegularFile(directory.appendingPathComponent(path)) else { return nil }
    }
    return LynxManagedRelease(feature: feature, manifestID: releaseID, version: completion.version, bundleURL: bundleURL)
  }

  /// Idempotent startup/after-install maintenance. It removes work-in-progress
  /// directories and incomplete releases, then evicts only unprotected oldest
  /// complete releases. State pointers are supplied by the deployment coordinator,
  /// so active/pending/previous candidates are never selected for eviction.
  func reconcile(feature: String, protectedReleaseIDs: Set<String>) throws {
    guard isSafeFeature(feature) else { return }
    let root = featureRoot(feature: feature)
    let staging = root.appendingPathComponent("staging", isDirectory: true)
    if fileManager.fileExists(atPath: staging.path) { try? fileManager.removeItem(at: staging) }
    let ready = root.appendingPathComponent("ready", isDirectory: true)
    guard let directories = try? fileManager.contentsOfDirectory(
      at: ready,
      includingPropertiesForKeys: [.isDirectoryKey, .contentModificationDateKey, .fileSizeKey],
      options: [.skipsHiddenFiles]
    ) else { return }
    var complete: [(url: URL, date: Date, size: Int64)] = []
    for directory in directories {
      guard (try? directory.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else { continue }
      let id = directory.lastPathComponent
      guard let release = try installedV2Release(feature: feature, releaseID: id) else {
        try? fileManager.removeItem(at: directory)
        continue
      }
      let values = try? directory.resourceValues(forKeys: [.contentModificationDateKey])
      complete.append((directory, values?.contentModificationDate ?? .distantPast, try directorySize(release.bundleURL.deletingLastPathComponent())))
    }
    var total = complete.reduce(Int64(0)) { $0 + $1.size }
    var remainingCount = complete.count
    for release in complete.sorted(by: { $0.date < $1.date }) where total > Self.maxReadyBytes || remainingCount > Self.maxReadyReleases {
      let id = release.url.lastPathComponent
      guard !protectedReleaseIDs.contains(id) else { continue }
      try? fileManager.removeItem(at: release.url)
      total -= release.size
      remainingCount -= 1
    }
  }

  private func readyURL(feature: String, manifestID: String) -> URL {
    rootURL
      .appendingPathComponent(feature, isDirectory: true)
      .appendingPathComponent("ready", isDirectory: true)
      .appendingPathComponent(manifestID, isDirectory: true)
  }

  private static let maxReadyReleases = 4
  private static let maxReadyBytes: Int64 = 256 * 1_024 * 1_024

  private func featureRoot(feature: String) -> URL {
    rootURL
      .appendingPathComponent(feature, isDirectory: true)
  }

  private func v2ReadyURL(feature: String, releaseID: String) -> URL {
    featureRoot(feature: feature)
      .appendingPathComponent("ready", isDirectory: true)
      .appendingPathComponent(releaseID, isDirectory: true)
  }

  private func migrateLegacyV2Release(feature: String, releaseID: String) throws -> Bool {
    let legacy = rootURL
      .appendingPathComponent(feature, isDirectory: true)
      .appendingPathComponent("active", isDirectory: true)
      .appendingPathComponent("ready", isDirectory: true)
      .appendingPathComponent(releaseID, isDirectory: true)
    let completion = legacy.appendingPathComponent("completion.json")
    guard isRegularFile(completion), isRegularFile(legacy.appendingPathComponent("main.lynx.bundle")) else { return false }
    let destination = v2ReadyURL(feature: feature, releaseID: releaseID)
    try fileManager.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
    guard !fileManager.fileExists(atPath: destination.path) else { return true }
    try fileManager.moveItem(at: legacy, to: destination)
    return true
  }

  private func ensureDiskSpace(requiredBytes: Int64) throws {
    let values = try? rootURL.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
    let available = values?.volumeAvailableCapacityForImportantUsage
    // Keep a modest reserve beyond the compressed + declared expanded bytes:
    // APFS metadata and the atomic promotion need working room too.
    let safetyMargin = max(Int64(10 * 1_024 * 1_024), requiredBytes / 10)
    let reservation = requiredBytes.addingReportingOverflow(safetyMargin)
    guard !reservation.overflow,
      available == nil || Int64(available!) >= reservation.partialValue
    else {
      throw LynxDeliveryError(stage: .resource, code: "ERR_LYNX_DISK_SPACE", message: "There is not enough free storage to install this Lynx release.")
    }
  }

  private func directorySize(_ directory: URL) throws -> Int64 {
    guard let enumerator = fileManager.enumerator(at: directory, includingPropertiesForKeys: [.fileSizeKey]) else { return 0 }
    var size: Int64 = 0
    for case let url as URL in enumerator {
      size += Int64((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
    }
    return size
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
