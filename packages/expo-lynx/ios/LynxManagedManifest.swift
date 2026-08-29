import CryptoKit
import Foundation

enum LynxDeliveryStage: String {
  case manifest
  case compatibility
  case download
  case checksum
  case resource
  case lynx
}

struct LynxDeliveryError: LocalizedError {
  let stage: LynxDeliveryStage
  let code: String
  let message: String

  var errorDescription: String? { message }
}

struct LynxManagedManifest: Codable, Sendable {
  struct FileEntry: Codable, Sendable {
    let url: String
    let sha256: String
    let bytes: Int64
  }

  struct ResourceEntry: Codable, Sendable {
    let path: String
    let url: String
    let sha256: String
    let bytes: Int64
  }

  let feature: String
  let version: String
  let minHostVersion: String
  let lynxEngineVersion: String
  let bundle: FileEntry
  let resources: [ResourceEntry]
  let signature: String

  static let supportedLynxEngineVersion = "4.0.0"

  static func decode(_ data: Data, expectedFeature: String) throws -> LynxManagedManifest {
    let manifest: LynxManagedManifest
    do {
      manifest = try JSONDecoder().decode(LynxManagedManifest.self, from: data)
    } catch {
      throw LynxDeliveryError(
        stage: .manifest,
        code: "ERR_LYNX_MANIFEST_INVALID",
        message: "The Lynx release manifest is not valid JSON: \(error.localizedDescription)"
      )
    }

    guard manifest.feature == expectedFeature else {
      throw LynxDeliveryError(
        stage: .manifest,
        code: "ERR_LYNX_MANIFEST_FEATURE",
        message: "Expected feature '\(expectedFeature)' but the manifest contains '\(manifest.feature)'."
      )
    }
    guard isSafeFeature(expectedFeature) else {
      throw LynxDeliveryError(
        stage: .manifest,
        code: "ERR_LYNX_FEATURE_INVALID",
        message: "The managed Lynx feature name is not safe for local storage."
      )
    }
    guard manifest.lynxEngineVersion == supportedLynxEngineVersion else {
      throw LynxDeliveryError(
        stage: .compatibility,
        code: "ERR_LYNX_ENGINE_INCOMPATIBLE",
        message:
          "This release requires Lynx \(manifest.lynxEngineVersion), but the host contains Lynx \(supportedLynxEngineVersion)."
      )
    }

    let hostVersion =
      Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
    guard compareVersions(hostVersion, manifest.minHostVersion) >= 0 else {
      throw LynxDeliveryError(
        stage: .compatibility,
        code: "ERR_LYNX_HOST_INCOMPATIBLE",
        message:
          "This release requires host version \(manifest.minHostVersion) or newer; the app is \(hostVersion)."
      )
    }

    try validateFile(
      url: manifest.bundle.url,
      sha256: manifest.bundle.sha256,
      bytes: manifest.bundle.bytes,
      path: "main.lynx.bundle"
    )
    var resourcePaths = Set<String>()
    for resource in manifest.resources {
      guard isSafeRelativePath(resource.path), resource.path != "main.lynx.bundle" else {
        throw LynxDeliveryError(
          stage: .resource,
          code: "ERR_LYNX_RESOURCE_PATH",
          message: "The manifest contains an unsafe resource path: \(resource.path)"
        )
      }
      guard resourcePaths.insert(resource.path).inserted else {
        throw LynxDeliveryError(
          stage: .resource,
          code: "ERR_LYNX_RESOURCE_DUPLICATE",
          message: "The manifest contains the resource path more than once: \(resource.path)"
        )
      }
      try validateFile(
        url: resource.url,
        sha256: resource.sha256,
        bytes: resource.bytes,
        path: resource.path
      )
    }

    return manifest
  }

  static func manifestID(for data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }

  static func sha256(of url: URL) throws -> String {
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }

    var hasher = SHA256()
    while let chunk = try handle.read(upToCount: 1024 * 1024), !chunk.isEmpty {
      hasher.update(data: chunk)
    }
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
  }

  private static func validateFile(url: String, sha256: String, bytes: Int64, path: String) throws {
    guard let parsedURL = URL(string: url), !url.isEmpty else {
      throw LynxDeliveryError(
        stage: .manifest,
        code: "ERR_LYNX_FILE_URL",
        message: "The manifest URL for \(path) is invalid."
      )
    }
    if let scheme = parsedURL.scheme?.lowercased(), scheme != "http" && scheme != "https" {
      throw LynxDeliveryError(
        stage: .manifest,
        code: "ERR_LYNX_FILE_URL",
        message: "The manifest URL for \(path) must use HTTP or HTTPS."
      )
    }
    if parsedURL.scheme == nil, !isSafeRelativePath(url) {
      throw LynxDeliveryError(
        stage: .manifest,
        code: "ERR_LYNX_FILE_URL",
        message: "The relative manifest URL for \(path) is unsafe."
      )
    }
    guard bytes >= 0 else {
      throw LynxDeliveryError(
        stage: .manifest,
        code: "ERR_LYNX_FILE_SIZE",
        message: "The manifest byte count for \(path) cannot be negative."
      )
    }
    let hashCharacters = CharacterSet(charactersIn: "0123456789abcdefABCDEF")
    guard sha256.count == 64,
      sha256.unicodeScalars.allSatisfy({ hashCharacters.contains($0) })
    else {
      throw LynxDeliveryError(
        stage: .manifest,
        code: "ERR_LYNX_FILE_HASH",
        message: "The manifest SHA-256 for \(path) is invalid."
      )
    }
  }

  private static func isSafeFeature(_ feature: String) -> Bool {
    guard !feature.isEmpty, feature.count <= 100 else { return false }
    return feature.unicodeScalars.allSatisfy {
      CharacterSet.alphanumerics.contains($0) || "-_.".unicodeScalars.contains($0)
    }
  }

  private static func isSafeRelativePath(_ path: String) -> Bool {
    guard !path.isEmpty,
      !path.hasPrefix("/"),
      !path.contains("\\"),
      !path.contains("\0")
    else { return false }

    let components = path.split(separator: "/", omittingEmptySubsequences: false)
    return components.allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." }
  }

  private static func compareVersions(_ lhs: String, _ rhs: String) -> Int {
    let left = lhs.split(separator: ".").map { Int($0.prefix { $0.isNumber }) ?? 0 }
    let right = rhs.split(separator: ".").map { Int($0.prefix { $0.isNumber }) ?? 0 }
    for index in 0..<max(left.count, right.count) {
      let leftPart = index < left.count ? left[index] : 0
      let rightPart = index < right.count ? right[index] : 0
      if leftPart != rightPart { return leftPart < rightPart ? -1 : 1 }
    }
    return 0
  }
}
