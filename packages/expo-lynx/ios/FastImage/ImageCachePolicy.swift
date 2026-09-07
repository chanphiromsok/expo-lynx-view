// Vendored from expo-image 57.0.4 — upstream/expo-image/ios/ImageCachePolicy.swift (MIT).
// Local changes vs upstream:
//   * `internal import SDWebImage` -> `import SDWebImage`; drop `ExpoModulesCore`
//   * drop `Enumerable`; add `from(_:)` string parser.

import SDWebImage

enum ImageCachePolicy: String {
  case none = "none"
  case disk = "disk"
  case memory = "memory"
  case memoryAndDisk = "memory-disk"

  static func from(_ value: String?) -> ImageCachePolicy? {
    guard let value else { return nil }
    return ImageCachePolicy(rawValue: value)
  }

  func toSdCacheType() -> SDImageCacheType {
    switch self {
    case .none:
      return .none
    case .disk:
      return .disk
    case .memory:
      return .memory
    case .memoryAndDisk:
      return .all
    }
  }
}
