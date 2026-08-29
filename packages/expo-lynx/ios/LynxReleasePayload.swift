import Foundation

/// Decoded only after `LynxSignatureVerifier` has authenticated the exact
/// envelope payload. This keeps URLs and cache identifiers outside the trust
/// boundary until the signature has succeeded.
struct LynxReleasePayload: Decodable, Sendable {
  struct Compatibility: Decodable, Sendable { let runtimeVersion: String; let minHostVersion: String; let lynxEngineVersion: String }
  struct Archive: Decodable, Sendable { let format: String; let url: String; let sha256: String; let bytes: Int64; let uncompressedBytes: Int64; let entryCount: Int }
  struct File: Decodable, Sendable { let path: String; let bytes: Int64; let sha256: String }
  let type: String
  let feature: String
  let releaseId: String
  let version: String
  let platform: String
  let compatibility: Compatibility
  let archive: Archive
  let files: [File]

  static func decodeVerified(_ data: Data, expectedFeature: String) throws -> LynxReleasePayload {
    let release: LynxReleasePayload
    do { release = try JSONDecoder().decode(Self.self, from: data) }
    catch { throw delivery("ERR_LYNX_RELEASE_INVALID", "The signed release payload is invalid.") }
    let releaseID = try! NSRegularExpression(pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
    let version = try! NSRegularExpression(pattern: "^[A-Za-z0-9][A-Za-z0-9.+-]{0,127}$")
    let feature = try! NSRegularExpression(pattern: "^[a-z][a-z0-9-]{0,63}$")
    func matches(_ expression: NSRegularExpression, _ value: String) -> Bool { expression.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) != nil }
    guard release.type == "lynx-release", release.feature == expectedFeature, matches(feature, expectedFeature), matches(releaseID, release.releaseId), matches(version, release.version), release.platform == "ios", release.archive.format == "zip", release.archive.bytes > 0, release.archive.bytes <= LynxArchiveLimits.maxArchiveBytes, release.archive.uncompressedBytes > 0, release.archive.uncompressedBytes <= LynxArchiveLimits.maxUncompressedBytes, release.archive.entryCount > 0, release.archive.entryCount <= LynxArchiveLimits.maxEntries, release.archive.uncompressedBytes / release.archive.bytes <= LynxArchiveLimits.maxCompressionRatio, validSHA(release.archive.sha256), safeURL(release.archive.url) else { throw delivery("ERR_LYNX_RELEASE_INVALID", "The signed release payload violates the V2 protocol.") }
    guard release.compatibility.lynxEngineVersion == LynxManagedManifest.supportedLynxEngineVersion else { throw delivery("ERR_LYNX_ENGINE_INCOMPATIBLE", "The signed release requires another Lynx engine version.") }
    let host = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
    guard compare(host, release.compatibility.minHostVersion) >= 0 else { throw delivery("ERR_LYNX_HOST_INCOMPATIBLE", "The signed release requires a newer host app.") }
    var paths = Set<String>(); var total: Int64 = 0
    for file in release.files { guard isSafePath(file.path), file.path.precomposedStringWithCanonicalMapping == file.path, paths.insert(file.path).inserted, file.bytes >= 0, file.bytes <= LynxArchiveLimits.maxSingleEntryBytes, validSHA(file.sha256) else { throw delivery("ERR_LYNX_RELEASE_FILE", "The signed release file list is invalid.") }; total += file.bytes }
    guard paths.contains("main.lynx.bundle"), total == release.archive.uncompressedBytes, release.files.count == release.archive.entryCount else { throw delivery("ERR_LYNX_RELEASE_CONTRACT", "The signed release archive contract is invalid.") }
    return release
  }

  private static func validSHA(_ value: String) -> Bool { value.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }
  private static func safeURL(_ value: String) -> Bool { guard let url = URL(string: value), !value.isEmpty else { return false }; return url.scheme == nil || url.scheme?.lowercased() == "http" || url.scheme?.lowercased() == "https" }
  private static func isSafePath(_ path: String) -> Bool {
    guard !path.isEmpty, !path.hasPrefix("/"), !path.contains("\\"), !path.contains("\0"), path.utf8.count <= LynxArchiveLimits.maxPathUTF8Bytes else { return false }
    let parts = path.split(separator: "/", omittingEmptySubsequences: false)
    return parts.count <= LynxArchiveLimits.maxPathDepth && parts.allSatisfy { part in
      !part.isEmpty && part != Substring(".") && part != Substring("..")
    }
  }
  private static func compare(_ lhs: String, _ rhs: String) -> Int { let a = lhs.split(separator: ".").map { Int($0.prefix { $0.isNumber }) ?? 0 }; let b = rhs.split(separator: ".").map { Int($0.prefix { $0.isNumber }) ?? 0 }; for i in 0..<max(a.count, b.count) { let x = i < a.count ? a[i] : 0, y = i < b.count ? b[i] : 0; if x != y { return x < y ? -1 : 1 } }; return 0 }
  private static func delivery(_ code: String, _ message: String) -> LynxDeliveryError { LynxDeliveryError(stage: .manifest, code: code, message: message) }
}
