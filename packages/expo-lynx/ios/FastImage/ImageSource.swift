// Vendored from expo-image 57.0.4 — upstream/expo-image/ios/ImageSource.swift (MIT).
// Local changes vs upstream (unavoidably larger — no Expo `Record`):
//   * `Record` + `@Field` -> plain struct decoded from the `NSDictionary` / `String`
//     that Lynx passes to a prop setter.
//   * added `parse(_:)`, scheme validation, and `isRemote` / `isBundledResource`
//     helpers used at the trust boundary (PLAN §3.7). Photo-library / SF Symbol
//     helpers are intentionally omitted from the core milestone.

import Foundation

struct ImageSource {
  var width: Double = 0.0
  var height: Double = 0.0
  var uri: URL?
  var scale: Double = 1.0
  var headers: [String: String]?
  var cacheKey: String?

  var pixelCount: Double {
    return width * height * scale * scale
  }

  var isBlurhash: Bool {
    return uri?.scheme == "blurhash"
  }

  var isThumbhash: Bool {
    return uri?.scheme == "thumbhash"
  }

  // MARK: - Trust boundary

  static let allowedRemoteSchemes: Set<String> = ["http", "https"]
  static let allowedLocalSchemes: Set<String> = ["file", "data"]

  /// Schemes we are willing to start a native request for. Everything else is
  /// rejected before a request is made.
  var hasSupportedScheme: Bool {
    guard let scheme = uri?.scheme?.lowercased() else {
      // Scheme-less strings are bundled resource names.
      return true
    }
    return Self.allowedRemoteSchemes.contains(scheme)
      || Self.allowedLocalSchemes.contains(scheme)
      || isBlurhash || isThumbhash
  }

  var isRemote: Bool {
    guard let scheme = uri?.scheme?.lowercased() else { return false }
    return Self.allowedRemoteSchemes.contains(scheme)
  }

  var isBundledResource: Bool {
    guard let uri else { return false }
    return uri.scheme == nil || uri.scheme == "file"
  }

  // MARK: - Decoding

  static func parse(_ value: Any?) -> ImageSource? {
    if let string = value as? String {
      return fromString(string)
    }
    if let dict = value as? [AnyHashable: Any] {
      return fromDictionary(dict)
    }
    return nil
  }

  private static func fromString(_ string: String) -> ImageSource? {
    let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    var source = ImageSource()
    source.uri = makeURL(from: trimmed)
    return source
  }

  private static func fromDictionary(_ dict: [AnyHashable: Any]) -> ImageSource? {
    var source = ImageSource()
    if let uri = (dict["uri"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !uri.isEmpty {
      source.uri = makeURL(from: uri)
    }
    if let width = dict["width"] as? NSNumber { source.width = width.doubleValue }
    if let height = dict["height"] as? NSNumber { source.height = height.doubleValue }
    if let scale = dict["scale"] as? NSNumber, scale.doubleValue > 0 { source.scale = scale.doubleValue }
    if let headers = dict["headers"] as? [String: String] { source.headers = headers }
    if let cacheKey = dict["cacheKey"] as? String, !cacheKey.isEmpty { source.cacheKey = cacheKey }
    guard source.uri != nil else { return nil }
    return source
  }

  private static func makeURL(from string: String) -> URL? {
    if let url = URL(string: string), url.scheme != nil {
      return url
    }
    return URL(fileURLWithPath: string)
  }
}
