// Vendored from expo-image 57.0.4 — upstream/expo-image/ios/ImagePriority.swift (MIT).
// Local changes vs upstream:
//   * `internal import SDWebImage` -> `import SDWebImage`; drop `ExpoModulesCore`
//   * drop `Enumerable`; add `from(_:)` string parser.

import SDWebImage

enum ImagePriority: String {
  case low
  case normal
  case high

  static func from(_ value: String?) -> ImagePriority? {
    guard let value else { return nil }
    return ImagePriority(rawValue: value)
  }

  /**
   Maps the priority to `SDWebImageOptions` which is a bitmask thus has only low and high priority options.
   */
  func toSDWebImageOptions() -> SDWebImageOptions? {
    switch self {
    case .low:
      return .lowPriority
    case .high:
      return .highPriority
    default:
      return nil
    }
  }
}
