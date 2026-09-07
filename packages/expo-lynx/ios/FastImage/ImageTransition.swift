// Vendored from expo-image 57.0.4 — upstream/expo-image/ios/ImageTransition.swift (MIT).
// Local changes vs upstream:
//   * drop `ExpoModulesCore` / `Symbols`; drop `Enumerable` / `Record`.
//   * SF Symbol replace effects removed (not in the core milestone).
//   * added `parse(_:)` accepting a number (ms) or `NSDictionary`.

import UIKit

enum ImageTransitionTiming: String {
  case easeInOut = "ease-in-out"
  case easeIn = "ease-in"
  case easeOut = "ease-out"
  case linear = "linear"

  func toAnimationOption() -> UIView.AnimationOptions {
    switch self {
    case .easeInOut:
      return .curveEaseInOut
    case .easeIn:
      return .curveEaseIn
    case .easeOut:
      return .curveEaseOut
    case .linear:
      return .curveLinear
    }
  }
}

enum ImageTransitionEffect: String {
  case crossDissolve = "cross-dissolve"
  case flipFromTop = "flip-from-top"
  case flipFromRight = "flip-from-right"
  case flipFromBottom = "flip-from-bottom"
  case flipFromLeft = "flip-from-left"
  case curlUp = "curl-up"
  case curlDown = "curl-down"

  func toAnimationOption() -> UIView.AnimationOptions {
    switch self {
    case .crossDissolve:
      return .transitionCrossDissolve
    case .flipFromLeft:
      return .transitionFlipFromLeft
    case .flipFromRight:
      return .transitionFlipFromRight
    case .flipFromTop:
      return .transitionFlipFromTop
    case .flipFromBottom:
      return .transitionFlipFromBottom
    case .curlUp:
      return .transitionCurlUp
    case .curlDown:
      return .transitionCurlDown
    }
  }
}

struct ImageTransition {
  var duration: Double = 100
  var timing: ImageTransitionTiming = .easeInOut
  var effect: ImageTransitionEffect = .crossDissolve

  func toAnimationOptions() -> UIView.AnimationOptions {
    return [timing.toAnimationOption(), effect.toAnimationOption()]
  }

  static func parse(_ value: Any?) -> ImageTransition? {
    if let number = value as? NSNumber {
      var transition = ImageTransition()
      transition.duration = number.doubleValue
      return transition
    }
    if let dict = value as? [AnyHashable: Any] {
      var transition = ImageTransition()
      if let duration = dict["duration"] as? NSNumber { transition.duration = duration.doubleValue }
      if let timing = dict["timing"] as? String, let parsed = ImageTransitionTiming(rawValue: timing) {
        transition.timing = parsed
      }
      if let effect = dict["effect"] as? String, let parsed = ImageTransitionEffect(rawValue: effect) {
        transition.effect = parsed
      }
      return transition
    }
    return nil
  }
}
