// Vendored from expo-image 57.0.4 — upstream/expo-image/ios/ImageCacheType.swift (MIT).
// Local changes vs upstream:
//   * `internal import SDWebImage` -> `import SDWebImage`; drop `ExpoModulesCore`
//   * drop `Enumerable`; `log.error` -> `NSLog`.

import SDWebImage

enum ImageCacheType: String {
  case none
  case disk
  case memory

  static func fromSdCacheType(_ sdImageCacheType: SDImageCacheType) -> ImageCacheType {
    switch sdImageCacheType {
    case .none:
      return .none
    case .disk, .all:
      return .disk
    case .memory:
      return .memory
    @unknown default:
      NSLog("[lynx-fast-image] Unhandled `SDImageCacheType` value: %d, returning `none` as fallback.", sdImageCacheType.rawValue)
      return .none
    }
  }
}
