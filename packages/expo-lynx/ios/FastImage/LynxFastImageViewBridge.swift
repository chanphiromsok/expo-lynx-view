// Objective-C <-> Swift glue for `LynxFastImageView`.
//
// Kept separate from `ImageView.swift` so that file stays a near-verbatim port of
// `upstream/expo-image/ios/ImageView.swift` and can be re-synced. Everything Lynx-
// specific (prop decoding from the JSON the wrapper serializes, imperative
// controls used by `LYNX_UI_METHOD`) lives here.

import UIKit

@objc public extension LynxFastImageView {
  /// `source` prop. `values` is the normalized array of `{ uri, headers?, ... }`
  /// dictionaries produced by the Obj-C wrapper.
  func applySources(fromJSONValues values: [[AnyHashable: Any]]) {
    let parsed = values.compactMap { ImageSource.parse($0) }
    setSources(parsed.isEmpty ? nil : parsed)
  }

  /// `placeholder` prop.
  func applyPlaceholder(fromJSONValues values: [[AnyHashable: Any]]) {
    placeholderSources = values.compactMap { ImageSource.parse($0) }
  }

  /// `content-position` prop.
  func applyContentPosition(fromJSONValue value: Any?) {
    contentPosition = ContentPosition.parse(value) ?? .center
  }

  /// `transition` prop.
  func applyTransition(fromJSONValue value: Any?) {
    transition = ImageTransition.parse(value)
  }

  /// `content-fit` prop.
  func applyContentFit(_ value: String?) {
    contentFit = ContentFit.from(value) ?? .cover
    sdImageView.contentMode = contentFit.toContentMode()
  }

  /// `placeholder-content-fit` prop.
  func applyPlaceholderContentFit(_ value: String?) {
    placeholderContentFit = ContentFit.from(value) ?? .scaleDown
  }

  /// `cache-policy` prop.
  func applyCachePolicy(_ value: String?) {
    cachePolicy = ImageCachePolicy.from(value) ?? .disk
  }

  /// `priority` prop.
  func applyPriority(_ value: String?) {
    priority = ImagePriority.from(value) ?? .normal
  }

  /// List-cell recycling: drop the current image + pending request so a recycled
  /// element can never show a stale result (PLAN §3.5).
  func prepareForReuse() {
    cancelPendingOperation()
    sdImageView.image = nil
    sourceImage = nil
    placeholderImage = nil
    sources = nil
  }
}
