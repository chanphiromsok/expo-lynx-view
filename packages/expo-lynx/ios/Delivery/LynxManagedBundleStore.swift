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
  private var activeStagingPaths = Set<String>()

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

  /// Read-only launch path for an already completed V2 release. It deliberately
  /// skips migration, hashing, directory scans, and actor scheduling so Lynx can
  /// receive its local template without an asynchronous gap.
  nonisolated func launchInstalledRelease(
    feature: String,
    releaseID: String,
    expectedRuntimeVersion: String
  ) -> LynxManagedRelease? {
    guard Self.isSafeFeatureValue(feature),
      Self.isSafeRuntimeVersionValue(expectedRuntimeVersion),
      releaseID.range(
        of: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$",
        options: .regularExpression
      ) != nil
    else { return nil }

    let directory = rootURL
      .appendingPathComponent(feature, isDirectory: true)
      .appendingPathComponent("ready", isDirectory: true)
      .appendingPathComponent(Self.runtimeCacheKey(expectedRuntimeVersion), isDirectory: true)
      .appendingPathComponent(releaseID, isDirectory: true)
    let completionURL = directory.appendingPathComponent("completion.json")
    let bundleURL = directory.appendingPathComponent("main.lynx.bundle")
    guard Self.isRegularFileValue(completionURL),
      Self.isRegularFileValue(bundleURL),
      let data = try? Data(contentsOf: completionURL, options: .mappedIfSafe),
      let completion = try? JSONDecoder().decode(V2Completion.self, from: data),
      completion.feature == feature,
      completion.releaseID == releaseID,
      completion.runtimeVersion == expectedRuntimeVersion
    else { return nil }

    return LynxManagedRelease(
      feature: feature,
      manifestID: releaseID,
      version: completion.version,
      bundleURL: bundleURL
    )
  }

  /// Fetches the one signed deployment document with ETag and revision replay
  /// protection. Artifact bytes are requested only for a new, unblocked ID.
  func checkForUpdate(
    deploymentURL: URL,
    expectedFeature: String,
    expectedRuntimeVersion: String,
    eTag: String?,
    lastRevision: Int?,
    blockedReleaseIDs: Set<String>,
    protectedReleaseIDs: Set<String>
  ) async throws -> LynxDeploymentUpdateResult {
    let key = "\(expectedFeature)/\(deploymentURL.absoluteString)"
    if let task = deploymentChecks[key] { return try await task.value }
    let task = Task { [self] in
      try await performDeploymentCheck(
        deploymentURL: deploymentURL,
        expectedFeature: expectedFeature,
        expectedRuntimeVersion: expectedRuntimeVersion,
        eTag: eTag,
        lastRevision: lastRevision,
        blockedReleaseIDs: blockedReleaseIDs,
        protectedReleaseIDs: protectedReleaseIDs
      )
    }
    deploymentChecks[key] = task
    defer { deploymentChecks[key] = nil }
    return try await task.value
  }

  private func performDeploymentCheck(
    deploymentURL: URL,
    expectedFeature: String,
    expectedRuntimeVersion: String,
    eTag: String?,
    lastRevision: Int?,
    blockedReleaseIDs: Set<String>,
    protectedReleaseIDs: Set<String>
  ) async throws -> LynxDeploymentUpdateResult {
    var request = noCacheURLRequest(deploymentURL)
    if let eTag, !eTag.isEmpty { request.setValue(eTag, forHTTPHeaderField: "If-None-Match") }
    request.setValue(expectedRuntimeVersion, forHTTPHeaderField: "lynx-runtime-version")
    request.setValue("ios", forHTTPHeaderField: "lynx-platform")
    let (deploymentBytes, response) = try await URLSession.shared.bytes(for: request)
    guard let httpResponse = response as? HTTPURLResponse else {
      throw LynxDeliveryError(stage: .download, code: "ERR_LYNX_HTTP_0", message: "The Lynx deployment response was not HTTP.")
    }
    if httpResponse.statusCode == 304 {
      return .notModified(eTag: httpResponse.value(forHTTPHeaderField: "ETag") ?? eTag)
    }
    try validateHTTPResponse(httpResponse, url: deploymentURL)
    let deploymentData = try await readBoundedResponse(
      deploymentBytes,
      response: httpResponse,
      limit: 16 * 1024
    )
    let deployment = try LynxDeploymentPayload.decodeVerified(
      LynxSignatureVerifier.verifyEmbedded(
        documentData: deploymentData,
        signature: httpResponse.value(forHTTPHeaderField: "lynx-signature"),
        expectedType: "lynx-deployment",
        expectedFeature: expectedFeature
      ),
      expectedFeature: expectedFeature,
      expectedRuntimeVersion: expectedRuntimeVersion
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
      let archiveURL = deployment.archiveUrl,
      let archiveSHA256 = deployment.archiveSha256,
      let archiveBytes = deployment.archiveBytes,
      let version = deployment.version,
      let force = deployment.force
    else {
      throw LynxDeliveryError(
        stage: .compatibility,
        code: "ERR_LYNX_RUNTIME_INCOMPATIBLE",
        message: "The enabled deployment is missing release fields or targets another runtime version."
      )
    }
    if blockedReleaseIDs.contains(releaseID) {
      return .blocked(
        releaseID: releaseID,
        eTag: responseETag,
        revision: deployment.revision
      )
    }
    if let installed = try installedV2Release(
      feature: expectedFeature,
      releaseID: releaseID,
      expectedRuntimeVersion: expectedRuntimeVersion
    ) {
      return .selected(
        release: installed,
        force: force,
        eTag: responseETag,
        revision: deployment.revision,
        downloaded: false
      )
    }

    let release = try await install(
      feature: expectedFeature,
      releaseID: releaseID,
      version: version,
      runtimeVersion: expectedRuntimeVersion,
      archiveURL: try resolveRemoteURL(archiveURL, relativeTo: deploymentURL),
      archiveBytes: archiveBytes,
      archiveSHA256: archiveSHA256,
      protectedReleaseIDs: protectedReleaseIDs
    )
    return .selected(
      release: release,
      force: force,
      eTag: responseETag,
      revision: deployment.revision,
      downloaded: true
    )
  }

  private func install(
    feature: String,
    releaseID: String,
    version: String,
    runtimeVersion: String,
    archiveURL: URL,
    archiveBytes: Int64,
    archiveSHA256: String,
    protectedReleaseIDs: Set<String>
  ) async throws -> LynxManagedRelease {
    let key = "\(feature)/\(runtimeVersion)/\(releaseID)"
    if let installed = try installedV2Release(
      feature: feature,
      releaseID: releaseID,
      expectedRuntimeVersion: runtimeVersion
    ) { return installed }
    if let task = v2Installs[key] { return try await task.value }
    let task = Task { [self] in
      try reconcile(
        feature: feature,
        runtimeVersion: runtimeVersion,
        protectedReleaseIDs: protectedReleaseIDs
      )
      try ensureDiskSpace(requiredBytes: archiveBytes + LynxArchiveLimits.maxUncompressedBytes)
      return try await performArchiveInstall(
        feature: feature,
        releaseID: releaseID,
        version: version,
        runtimeVersion: runtimeVersion,
        archiveURL: archiveURL,
        archiveBytes: archiveBytes,
        archiveSHA256: archiveSHA256
      )
    }
    v2Installs[key] = task
    defer { v2Installs[key] = nil }
    return try await task.value
  }

  private func performArchiveInstall(
    feature: String,
    releaseID: String,
    version: String,
    runtimeVersion: String,
    archiveURL: URL,
    archiveBytes: Int64,
    archiveSHA256: String
  ) async throws -> LynxManagedRelease {
    let featureRoot = featureRoot(feature: feature)
    let staging = featureRoot.appendingPathComponent("staging", isDirectory: true).appendingPathComponent(UUID().uuidString, isDirectory: true)
    let extracted = staging.appendingPathComponent("release", isDirectory: true)
    let archive = staging.appendingPathComponent("release.zip.part")
    activeStagingPaths.insert(staging.standardizedFileURL.path)
    defer {
      activeStagingPaths.remove(staging.standardizedFileURL.path)
      try? fileManager.removeItem(at: staging)
    }
    try fileManager.createDirectory(at: staging, withIntermediateDirectories: true)
    try await downloadArchive(
      from: archiveURL,
      to: archive,
      expectedBytes: archiveBytes,
      expectedHash: archiveSHA256
    )
    try LynxSafeArchive.extract(archiveURL: archive, to: extracted)
    let completion = V2Completion(
      feature: feature,
      releaseID: releaseID,
      version: version,
      runtimeVersion: runtimeVersion,
      archiveSHA256: archiveSHA256
    )
    try JSONEncoder().encode(completion).write(to: extracted.appendingPathComponent("completion.json"), options: .atomic)
    let final = v2ReadyURL(
      feature: feature,
      runtimeVersion: runtimeVersion,
      releaseID: releaseID
    )
    try fileManager.createDirectory(at: final.deletingLastPathComponent(), withIntermediateDirectories: true)
    if !fileManager.fileExists(atPath: final.path) { try fileManager.moveItem(at: extracted, to: final) }
    guard let installed = try installedV2Release(
      feature: feature,
      releaseID: releaseID,
      expectedRuntimeVersion: runtimeVersion
    ) else { throw LynxDeliveryError(stage: .archive, code: "ERR_LYNX_RELEASE_INSTALL", message: "The completed Lynx release could not be reopened.") }
    return installed
  }

  private func installedV2Release(
    feature: String,
    releaseID: String,
    expectedRuntimeVersion: String
  ) throws -> LynxManagedRelease? {
    guard isSafeFeature(feature), releaseID.range(of: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$", options: .regularExpression) != nil else { return nil }
    let directory = v2ReadyURL(
      feature: feature,
      runtimeVersion: expectedRuntimeVersion,
      releaseID: releaseID
    )
    let completionURL = directory.appendingPathComponent("completion.json")
    let bundleURL = directory.appendingPathComponent("main.lynx.bundle")
    guard isRegularFile(completionURL), isRegularFile(bundleURL), let completion = try? JSONDecoder().decode(V2Completion.self, from: Data(contentsOf: completionURL)), completion.feature == feature, completion.releaseID == releaseID, completion.runtimeVersion == expectedRuntimeVersion else { return nil }
    // Archive SHA-256 and ZIP structure were checked during installation. A
    // healthy cache reopen needs only its atomic completion marker and entry
    // bundle; it never rereads every installed asset.
    return LynxManagedRelease(feature: feature, manifestID: releaseID, version: completion.version, bundleURL: bundleURL)
  }

  /// Removes abandoned staging and unprotected old complete releases before a
  /// new installation. The current native runtime is the only live app process.
  func reconcile(
    feature: String,
    runtimeVersion: String,
    protectedReleaseIDs: Set<String>
  ) throws {
    guard isSafeFeature(feature), Self.isSafeRuntimeVersionValue(runtimeVersion) else { return }
    let root = featureRoot(feature: feature)
    let staging = root.appendingPathComponent("staging", isDirectory: true)
    removeInactiveStagingDirectories(at: staging)
    let ready = v2ReadyRoot(feature: feature, runtimeVersion: runtimeVersion)
    guard let directories = try? fileManager.contentsOfDirectory(
      at: ready,
      includingPropertiesForKeys: [.isDirectoryKey, .contentModificationDateKey],
      options: [.skipsHiddenFiles]
    ) else { return }
    var complete: [(url: URL, date: Date, size: Int64)] = []
    for directory in directories {
      guard (try? directory.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else { continue }
      let releaseID = directory.lastPathComponent
      guard isCompleteV2Release(
        feature: feature,
        runtimeVersion: runtimeVersion,
        releaseID: releaseID,
        directory: directory
      ) else {
        try? fileManager.removeItem(at: directory)
        continue
      }
      let values = try? directory.resourceValues(forKeys: [.contentModificationDateKey])
      complete.append((directory, values?.contentModificationDate ?? .distantPast, directorySize(directory)))
    }
    var total = complete.reduce(Int64(0)) { $0 + $1.size }
    var remaining = complete.count
    for release in complete.sorted(by: { $0.date < $1.date }) where total > Self.maxReadyBytes || remaining > Self.maxReadyReleases {
      guard !protectedReleaseIDs.contains(release.url.lastPathComponent) else { continue }
      try? fileManager.removeItem(at: release.url)
      total -= release.size
      remaining -= 1
    }
  }

  private static let maxReadyReleases = 4
  private static let maxReadyBytes: Int64 = 256 * 1_024 * 1_024

  private func isCompleteV2Release(
    feature: String,
    runtimeVersion: String,
    releaseID: String,
    directory: URL
  ) -> Bool {
    guard releaseID.range(of: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$", options: .regularExpression) != nil,
      let completion = try? JSONDecoder().decode(
        V2Completion.self,
        from: Data(contentsOf: directory.appendingPathComponent("completion.json"))
      )
    else { return false }
    return completion.feature == feature
      && completion.releaseID == releaseID
      && completion.runtimeVersion == runtimeVersion
      && isRegularFile(directory.appendingPathComponent("main.lynx.bundle"))
  }

  private func directorySize(_ directory: URL) -> Int64 {
    guard let enumerator = fileManager.enumerator(at: directory, includingPropertiesForKeys: [.fileSizeKey]) else { return 0 }
    var total: Int64 = 0
    for case let file as URL in enumerator {
      total += Int64((try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
    }
    return total
  }

  private func featureRoot(feature: String) -> URL {
    rootURL
      .appendingPathComponent(feature, isDirectory: true)
  }

  private func v2ReadyRoot(feature: String, runtimeVersion: String) -> URL {
    featureRoot(feature: feature)
      .appendingPathComponent("ready", isDirectory: true)
      .appendingPathComponent(Self.runtimeCacheKey(runtimeVersion), isDirectory: true)
  }

  private func v2ReadyURL(feature: String, runtimeVersion: String, releaseID: String) -> URL {
    v2ReadyRoot(feature: feature, runtimeVersion: runtimeVersion)
      .appendingPathComponent(releaseID, isDirectory: true)
  }

  private func ensureDiskSpace(requiredBytes: Int64) throws {
    var volumeURL = rootURL
    while !fileManager.fileExists(atPath: volumeURL.path), volumeURL.path != "/" {
      volumeURL.deleteLastPathComponent()
    }
    let values = try? volumeURL.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
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

  private func removeInactiveStagingDirectories(at stagingRoot: URL) {
    guard let entries = try? fileManager.contentsOfDirectory(
      at: stagingRoot,
      includingPropertiesForKeys: nil,
      options: [.skipsHiddenFiles]
    ) else { return }
    for entry in entries
    where !activeStagingPaths.contains(entry.standardizedFileURL.path) {
      try? fileManager.removeItem(at: entry)
    }
  }

  private func isRegularFile(_ url: URL) -> Bool {
    guard fileManager.fileExists(atPath: url.path) else { return false }
    guard let values = try? url.resourceValues(forKeys: [.isDirectoryKey]) else { return false }
    return values.isDirectory != true
  }

  private func isSafeFeature(_ feature: String) -> Bool {
    Self.isSafeFeatureValue(feature)
  }

  private nonisolated static func isSafeFeatureValue(_ feature: String) -> Bool {
    guard !feature.isEmpty, feature.count <= 100 else { return false }
    return feature.unicodeScalars.allSatisfy {
      CharacterSet.alphanumerics.contains($0) || "-_.".unicodeScalars.contains($0)
    }
  }

  private nonisolated static func isSafeRuntimeVersionValue(_ value: String) -> Bool {
    !value.isEmpty && value.utf8.count <= 128 && !value.contains("\0")
  }

  private nonisolated static func runtimeCacheKey(_ runtimeVersion: String) -> String {
    SHA256.hash(data: Data(runtimeVersion.utf8)).map { String(format: "%02x", $0) }.joined()
  }

  private nonisolated static func isRegularFileValue(_ url: URL) -> Bool {
    guard FileManager.default.fileExists(atPath: url.path),
      let values = try? url.resourceValues(forKeys: [.isDirectoryKey])
    else { return false }
    return values.isDirectory != true
  }

  /// Streams the authenticated ZIP to the private transaction directory. The
  /// signed deployment supplies both exact byte length and SHA-256, so a
  /// misleading Content-Length is rejected before extraction and a response
  /// that exceeds the contract is never fully written to disk.
  private func downloadArchive(
    from remoteURL: URL,
    to destinationURL: URL,
    expectedBytes: Int64,
    expectedHash: String
  ) async throws {
    var request = noCacheURLRequest(remoteURL)
    request.timeoutInterval = 60
    let (bytes, response) = try await URLSession.shared.bytes(for: request)
    try validateHTTPResponse(response, url: remoteURL)
    if let response = response as? HTTPURLResponse,
      let contentLength = response.value(forHTTPHeaderField: "Content-Length")
    {
      guard let length = Int64(contentLength), length == expectedBytes else {
        throw LynxDeliveryError(
          stage: .checksum,
          code: "ERR_LYNX_SIZE_MISMATCH",
          message: "The release ZIP Content-Length does not match the signed deployment."
        )
      }
    }

    try fileManager.createDirectory(
      at: destinationURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    guard fileManager.createFile(atPath: destinationURL.path, contents: nil) else {
      throw LynxDeliveryError(
        stage: .resource,
        code: "ERR_LYNX_ARCHIVE_CREATE",
        message: "The release ZIP transaction file could not be created."
      )
    }

    let output = try FileHandle(forWritingTo: destinationURL)
    defer { try? output.close() }
    var hasher = SHA256()
    var written: Int64 = 0
    var buffer = Data()
    buffer.reserveCapacity(64 * 1024)
    for try await byte in bytes {
      guard written < expectedBytes else {
        throw LynxDeliveryError(
          stage: .checksum,
          code: "ERR_LYNX_SIZE_MISMATCH",
          message: "The release ZIP exceeds the signed byte length."
        )
      }
      buffer.append(byte)
      written += 1
      if buffer.count == 64 * 1024 {
        output.write(buffer)
        hasher.update(data: buffer)
        buffer.removeAll(keepingCapacity: true)
      }
    }
    if !buffer.isEmpty {
      output.write(buffer)
      hasher.update(data: buffer)
    }
    guard written == expectedBytes else {
      throw LynxDeliveryError(
        stage: .checksum,
        code: "ERR_LYNX_SIZE_MISMATCH",
        message: "The release ZIP byte length does not match the signed deployment."
      )
    }
    let actualHash = hasher.finalize().map { String(format: "%02x", $0) }.joined()
    guard actualHash == expectedHash else {
      throw LynxDeliveryError(
        stage: .checksum,
        code: "ERR_LYNX_SHA256_MISMATCH",
        message: "The release ZIP SHA-256 does not match the signed deployment."
      )
    }
  }

  private func readBoundedResponse(
    _ bytes: URLSession.AsyncBytes,
    response: HTTPURLResponse,
    limit: Int
  ) async throws -> Data {
    if let contentLength = response.value(forHTTPHeaderField: "Content-Length") {
      guard let length = Int(contentLength), length >= 0, length <= limit else {
        throw LynxDeliveryError(
          stage: .signature,
          code: "ERR_LYNX_DEPLOYMENT_TOO_LARGE",
          message: "The signed Lynx deployment response exceeds 16 KiB."
        )
      }
    }
    var body = Data()
    body.reserveCapacity(min(limit, 1024))
    for try await byte in bytes {
      guard body.count < limit else {
        throw LynxDeliveryError(
          stage: .signature,
          code: "ERR_LYNX_DEPLOYMENT_TOO_LARGE",
          message: "The signed Lynx deployment response exceeds 16 KiB."
        )
      }
      body.append(byte)
    }
    return body
  }

  private func noCacheURLRequest(_ url: URL) -> URLRequest {
    var request = URLRequest(url: url)
    // A development phone can leave the LAN or lose Wi-Fi while a release is
    // being fetched. Bound deployment and ZIP requests so a
    // managed load can surface an error and reveal the embedded fallback
    // instead of leaving the host splash visible forever.
    request.timeoutInterval = 15
    request.cachePolicy = .reloadIgnoringLocalCacheData
    request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
    return request
  }

  private func resolveRemoteURL(_ value: String, relativeTo deploymentURL: URL) throws -> URL {
    guard let url = URL(string: value, relativeTo: deploymentURL)?.absoluteURL,
      let scheme = url.scheme?.lowercased(),
      scheme == "http" || scheme == "https"
    else {
      throw LynxDeliveryError(
        stage: .manifest,
        code: "ERR_LYNX_FILE_URL",
        message: "A Lynx release file URL could not be resolved: \(value)"
      )
    }
    #if !DEBUG && !LYNX_ALLOW_LOCAL_MANAGED_RELEASE
      guard scheme == "https" else {
        throw LynxDeliveryError(
          stage: .manifest,
          code: "ERR_LYNX_LOCAL_HTTP_FORBIDDEN",
          message: "Cleartext managed delivery is allowed only in an internal Release build."
        )
      }
    #endif
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
