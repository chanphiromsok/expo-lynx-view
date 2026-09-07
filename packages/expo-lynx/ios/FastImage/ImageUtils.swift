// Vendored from expo-image 57.0.4 — upstream/expo-image/ios/Utils/ImageUtils.swift (MIT).
// Local changes vs upstream:
//   * `internal import SDWebImage` -> `import SDWebImage`; drop `ExpoModulesCore`.
//   * dropped the Expo `Exception` subclasses and the async map helpers (unused here).
//   * `log.error` -> `NSLog`; `ImageView` -> `LynxFastImageView`.
//   * `imageCoderOptionUseAppleWebpCodec` constant inlined here (upstream defines it
//     in Coders/WebPCoder.swift, which we do not vendor yet).

import SDWebImage
import UIKit

let imageCoderOptionUseAppleWebpCodec = SDImageCoderOption(rawValue: "useAppleWebpCodec")

func cacheTypeToString(_ cacheType: SDImageCacheType) -> String {
  switch cacheType {
  case .none:
    return "none"
  case .disk:
    return "disk"
  case .memory, .all:
    // `all` doesn't make much sense, so we treat it as `memory`.
    return "memory"
  @unknown default:
    NSLog("[lynx-fast-image] Unhandled `SDImageCacheType` value: %d, returning `none` as fallback.", cacheType.rawValue)
    return "none"
  }
}

func imageFormatToMediaType(_ format: SDImageFormat) -> String? {
  switch format {
  case .undefined:
    return nil
  case .JPEG:
    return "image/jpeg"
  case .PNG:
    return "image/png"
  case .GIF:
    return "image/gif"
  case .TIFF:
    return "image/tiff"
  case .webP:
    return "image/webp"
  case .HEIC:
    return "image/heic"
  case .HEIF:
    return "image/heif"
  case .PDF:
    return "application/pdf"
  case .SVG:
    return "image/svg+xml"
  default:
    return nil
  }
}

/**
 Calculates the ideal size that fills in the container size while maintaining the source aspect ratio.
 */
func idealSize(contentPixelSize: CGSize, containerSize: CGSize, scale: Double = 1.0, contentFit: ContentFit) -> CGSize {
  switch contentFit {
  case .contain:
    let aspectRatio = min(containerSize.width / contentPixelSize.width, containerSize.height / contentPixelSize.height)
    return contentPixelSize * aspectRatio
  case .cover:
    let aspectRatio = max(containerSize.width / contentPixelSize.width, containerSize.height / contentPixelSize.height)
    return contentPixelSize * aspectRatio
  case .fill:
    return containerSize
  case .scaleDown:
    if containerSize.width < contentPixelSize.width / scale || containerSize.height < contentPixelSize.height / scale {
      let aspectRatio = min(containerSize.width / contentPixelSize.width, containerSize.height / contentPixelSize.height)
      return contentPixelSize * aspectRatio
    } else {
      return contentPixelSize / scale
    }
  case .none:
    return contentPixelSize / scale
  }
}

/**
 Returns a bool whether the image should be downscaled to the given size.
 */
func shouldDownscale(image: UIImage, toSize size: CGSize, scale: Double) -> Bool {
  if size.width <= 0 || size.height <= 0 {
    return true
  }
  if size.width.isInfinite || size.height.isInfinite {
    return false
  }
  let imageSize = image.size * image.scale
  return imageSize.width > (size.width * scale) && imageSize.height > (size.height * scale)
}

/**
 Resizes a static image to fit in the given size and scale.
 */
func resize(image: UIImage, toSize size: CGSize, scale: Double) -> UIImage {
  let format = UIGraphicsImageRendererFormat()
  format.scale = scale

  return UIGraphicsImageRenderer(size: size, format: format).image { _ in
    image.draw(in: CGRect(origin: .zero, size: size))
  }
}

/**
 The image source that fits best into the given size, that is the one with the closest number of pixels.
 */
func getBestSource(from sources: [ImageSource]?, forSize size: CGSize, scale: Double = 1.0) -> ImageSource? {
  guard let sources = sources, !sources.isEmpty else {
    return nil
  }
  if size.width <= 0 || size.height <= 0 {
    return nil
  }
  if sources.count == 1 {
    return sources.first
  }
  var bestSource: ImageSource?
  var bestFit = Double.infinity
  let targetPixelCount = size.width * size.height * scale * scale

  for source in sources {
    let fit = abs(1 - (source.pixelCount / targetPixelCount))

    if fit < bestFit {
      bestSource = source
      bestFit = fit
    }
  }
  return bestSource
}

/**
 Creates the cache key filter that returns the specific string.
 */
func createCacheKeyFilter(_ cacheKey: String?) -> SDWebImageCacheKeyFilter? {
  guard let cacheKey = cacheKey else {
    return nil
  }
  return SDWebImageCacheKeyFilter { _ in
    return cacheKey
  }
}

/**
 Creates a default image context based on the source and the cache policy.
 */
func createSDWebImageContext(forSource source: ImageSource, cachePolicy: ImageCachePolicy = .disk, useAppleWebpCodec: Bool = true) -> [SDWebImageContextOption: Any] {
  var context = [SDWebImageContextOption: Any]()

  // Modify URL request to add headers.
  if let headers = source.headers {
    context[.downloadRequestModifier] = SDWebImageDownloaderRequestModifier(headers: headers)
  }

  // Allow for custom cache key. If not specified in the source, its uri is used as the key.
  context[.cacheKeyFilter] = createCacheKeyFilter(source.cacheKey)

  // Tell SDWebImage to use our own class for animated formats.
  context[.animatedImageClass] = AnimatedImage.self

  context[.imageDecodeOptions] = [
    imageCoderOptionUseAppleWebpCodec: useAppleWebpCodec
  ]

  // Assets from the bundler have `scale` which needs to be passed to the context.
  context[.imageScaleFactor] = source.scale

  let sdCacheType = cachePolicy.toSdCacheType().rawValue
  context[.queryCacheType] = sdCacheType
  context[.storeCacheType] = sdCacheType
  context[.originalQueryCacheType] = sdCacheType
  context[.originalStoreCacheType] = sdCacheType

  // Some loaders may need access to the source.
  context[LynxFastImageView.contextSourceKey] = source

  return context
}

extension CGSize {
  static func * (size: CGSize, scalar: Double) -> CGSize {
    return CGSize(width: size.width * scalar, height: size.height * scalar)
  }

  static func / (size: CGSize, scalar: Double) -> CGSize {
    return CGSize(width: size.width / scalar, height: size.height / scalar)
  }

  func rounded(_ rule: FloatingPointRoundingRule) -> CGSize {
    return CGSize(width: width.rounded(rule), height: height.rounded(rule))
  }
}
