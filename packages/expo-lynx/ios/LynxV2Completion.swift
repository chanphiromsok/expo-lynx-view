import Foundation

/// Written atomically immediately before staging becomes ready. Cached opens
/// only read this marker and test main.lynx.bundle; they never rehash content.
struct V2Completion: Codable, Sendable {
  let feature: String
  let releaseID: String
  let version: String
  let archiveSHA256: String
  /// Signed archive entries validated during installation. Cached opens only
  /// check that these paths still exist; they never rehash the completed ZIP.
  let files: [String]?
}
