// Vendored from expo-image 57.0.4 — upstream/expo-image/ios/ContentFit.swift (MIT).
// Local changes vs upstream (keep minimal so the file can be re-synced):
//   * `import ExpoModulesCore` -> `import UIKit`
//   * drop `Enumerable` conformance; add `from(_:)` string parser for the Lynx boundary.

import UIKit

/**
 Describes how the image should be resized to fit its container.
 - Note: It mirrors the CSS [`object-fit`](https://developer.mozilla.org/en-US/docs/Web/CSS/object-fit) property.
 */
enum ContentFit: String {
  case contain
  case cover
  case fill
  case none
  case scaleDown = "scale-down"

  static func from(_ value: String?) -> ContentFit? {
    guard let value else { return nil }
    return ContentFit(rawValue: value)
  }

  /**
   `ContentFit` cases can be directly translated to the native `UIView.ContentMode`
   except `scaleDown` that needs to be handled differently at the later step of rendering.
   */
  func toContentMode() -> UIView.ContentMode {
    switch self {
    case .contain:
      return .scaleAspectFit
    case .cover:
      return .scaleAspectFill
    case .fill:
      return .scaleToFill
    case .none, .scaleDown:
      return .center
    }
  }
}
