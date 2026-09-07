// Vendored from expo-image 57.0.4 — upstream/expo-image/ios/ContentPosition.swift (MIT).
// Local changes vs upstream:
//   * `Record` + `@Field` + `Either<Double, String>` -> plain struct decoded from
//     an `NSDictionary`; values are `NSNumber` points or percentage/"center" strings.
//   * offset math is unchanged.

import CoreGraphics
import Foundation

struct ContentPosition {
  static let center = ContentPosition()

  var top: Any?
  var bottom: Any?
  var right: Any?
  var left: Any?

  static func parse(_ value: Any?) -> ContentPosition? {
    guard let dict = value as? [AnyHashable: Any] else { return nil }
    var position = ContentPosition()
    position.top = dict["top"]
    position.bottom = dict["bottom"]
    position.left = dict["left"]
    position.right = dict["right"]
    return position
  }

  func offsetX(contentWidth: Double, containerWidth: Double) -> Double {
    let diff = containerWidth - contentWidth

    if let leftDistance = distance(from: left) {
      return -diff / 2 + leftDistance
    }
    if let rightDistance = distance(from: right) {
      return diff / 2 - rightDistance
    }
    if let factor = factor(from: left) {
      return -diff / 2 + diff * factor
    }
    if let factor = factor(from: right) {
      return diff / 2 - diff * factor
    }
    return 0
  }

  func offsetY(contentHeight: Double, containerHeight: Double) -> Double {
    let diff = containerHeight - contentHeight

    if let topDistance = distance(from: top) {
      return -diff / 2 + topDistance
    }
    if let bottomDistance = distance(from: bottom) {
      return diff / 2 - bottomDistance
    }
    if let factor = factor(from: top) {
      return -diff / 2 + diff * factor
    }
    if let factor = factor(from: bottom) {
      return diff / 2 - diff * factor
    }
    return 0
  }

  func offset(contentSize: CGSize, containerSize: CGSize) -> CGPoint {
    return CGPoint(
      x: offsetX(contentWidth: contentSize.width, containerWidth: containerSize.width),
      y: offsetY(contentHeight: contentSize.height, containerHeight: containerSize.height)
    )
  }

  private func distance(from value: Any?) -> Double? {
    if let value = value as? NSNumber {
      return value.doubleValue
    }
    if let value = value as? String {
      return Double(value)
    }
    return nil
  }

  private func factor(from value: Any?) -> Double? {
    guard let value = value as? String else {
      return nil
    }
    if value == "center" {
      return 0.5
    }
    guard value.contains("%"), let percentage = Double(value.replacingOccurrences(of: "%", with: "")) else {
      return nil
    }
    return percentage / 100
  }
}
