// Vendored from expo-image 57.0.4 — upstream/expo-image/ios/ImageView.swift (MIT).
// Local changes vs upstream (this is the largest port; keep the structure close to
// upstream so behaviour can be compared):
//   * `ExpoView` -> `UIView`; removed `ExpoModulesCore`, `AppContext`, Expo
//     `EventDispatcher`, `ImageModule`, `Symbols`, `VisionKit`.
//   * Events are reported to `delegate` (implemented by the Obj-C `LynxUI` wrapper),
//     not Expo dispatchers.
//   * Removed: SF Symbols, Live Text / VisionKit, photo-library URLs, HDR decoding,
//     `SharedRef` / `ImageRef`. These are explicitly out of the core milestone.
//   * Kept: `SDAnimatedImageView`, `SDImageCache.shared`, `SDImageLoadersManager.shared`,
//     downsampling, best-source selection, cache policy, content positioning,
//     transitions, tinting, blur, and request cancellation.

import SDWebImage
import UIKit

typealias SDWebImageContext = [SDWebImageContextOption: Any]

// `LynxFastImageViewDelegate` and `LynxFastImageViewBridge` are declared in the
// plain Obj-C header `LynxFastImageViewProtocol.h` (visible here for free).

@objc(LynxFastImageView)
public final class LynxFastImageView: UIView, LynxFastImageViewBridge {
  nonisolated static let contextSourceKey = SDWebImageContextOption(rawValue: "source")
  nonisolated static let screenScaleKey = SDWebImageContextOption(rawValue: "screenScale")
  nonisolated static let contentFitKey = SDWebImageContextOption(rawValue: "contentFit")
  nonisolated static let frameSizeKey = SDWebImageContextOption(rawValue: "frameSize")

  let sdImageView = SDAnimatedImageView(frame: .zero)

  // Custom image manager, wired to the process-wide cache + loaders so cache
  // state is shared with Expo Image.
  let imageManager = SDWebImageManager(
    cache: SDImageCache.shared,
    loader: SDImageLoadersManager.shared
  )

  var loadingOptions: SDWebImageOptions = [
    .retryFailed,
    .handleCookies,
    .transformAnimatedImage
  ]

  @objc public weak var delegate: LynxFastImageViewDelegate?

  var sources: [ImageSource]?
  var sourceImage: UIImage?
  var pendingOperation: SDWebImageCombinedOperation?

  /// Monotonic id bumped every time a new load starts *or* pending work is
  /// invalidated. A completion whose captured id no longer matches belongs to a
  /// superseded request and must not touch the view (PLAN §3.5 — recycled
  /// elements cannot display stale images).
  var loadGeneration: Int = 0

  var contentFit: ContentFit = .cover
  var contentPosition: ContentPosition = .center
  var transition: ImageTransition?
  @objc public var blurRadius: CGFloat = 0.0
  @objc public var imageTintColor: UIColor?
  var cachePolicy: ImageCachePolicy = .disk
  var priority: ImagePriority = .normal
  @objc public var allowDownscaling: Bool = true
  @objc public var autoplay: Bool = true

  @objc public var recyclingKey: String? {
    didSet {
      if oldValue != nil && recyclingKey != oldValue {
        sdImageView.image = nil
        placeholderImage = nil
        sourceImage = nil
      }
    }
  }

  /// `idealSize` before rounding, used only for `contentPosition` math.
  var imageLayoutSize: CGSize = .zero

  // MARK: - View

  public override var bounds: CGRect {
    didSet {
      if oldValue.size != bounds.size && bounds.size != .zero {
        reload()
      }
    }
  }

  public override func layoutSubviews() {
    super.layoutSubviews()

    // Nothing sizes `sdImageView` for us (no ExpoView / RN layout here), so mirror
    // our bounds onto it. `applyContentPosition` then nudges only its origin.
    if sdImageView.bounds.size != bounds.size {
      sdImageView.frame = CGRect(origin: sdImageView.frame.origin, size: bounds.size)
      applyContentPosition(contentSize: imageLayoutSize == .zero ? bounds.size : imageLayoutSize,
                           containerSize: bounds.size)
    }

    // The Lynx wrapper sets our frame after layout; `bounds.didSet` alone is not
    // reliably delivered for a LynxUI-managed view, so also (re)load here once a
    // real size is available.
    if bounds.size != .zero, isViewEmpty || pendingOperation == nil {
      reload()
    }
  }

  public override init(frame: CGRect) {
    super.init(frame: frame)

    Self.registerCodersIfNeeded()

    clipsToBounds = true
    sdImageView.contentMode = contentFit.toContentMode()
    sdImageView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    sdImageView.layer.masksToBounds = false
    sdImageView.layer.magnificationFilter = .trilinear
    sdImageView.layer.minificationFilter = .trilinear

    addSubview(sdImageView)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  deinit {
    cancelPendingOperation()
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    // Pause/resume animated images as the element leaves/returns to the visible tree.
    if window == nil {
      sdImageView.stopAnimating()
    } else if autoplay, sdImageView.image?.sd_isAnimated == true {
      sdImageView.startAnimating()
    }
  }

  // MARK: - Public control

  /// Called by the wrapper once a new `source` has been applied.
  func setSources(_ sources: [ImageSource]?) {
    self.sources = sources
    reload(force: true)
  }

  @objc public func startAnimating() {
    sdImageView.startAnimating()
  }

  @objc public func stopAnimating() {
    sdImageView.stopAnimating()
  }

  // MARK: - Implementation

  func reload(force: Bool = false) {
    if isViewEmpty {
      if placeholderImage != nil {
        displayPlaceholderIfNecessary()
      } else {
        loadPlaceholderIfNecessary()
      }
    }
    guard let source = bestSource else {
      cancelPendingOperation()
      displayPlaceholderIfNecessary()
      return
    }

    // Validate the scheme before we touch the network (PLAN §3.7).
    guard source.hasSupportedScheme, let uri = source.uri else {
      delegate?.fastImageView(self, didFailWithError: "Unsupported image source URL")
      return
    }

    // Bundled app resources (scheme-less name or `file:` URL) resolve
    // synchronously from the bundle — no network, no SDWebImage cache. Handle
    // them before the remote path.
    if source.isBundledResource, renderLocalResource(source) {
      return
    }

    if sdImageView.image == nil {
      sdImageView.contentMode = contentFit.toContentMode()
    }

    var context = createBaseImageContext(source: source)

    // Cancel currently running load requests so an older completion cannot win.
    cancelPendingOperation()

    if blurRadius > 0 {
      context[.imageTransformer] = createTransformPipeline()
    }

    let shouldEarlyResize = imageTintColor != nil
    if shouldEarlyResize {
      context[.imagePreserveAspectRatio] = true
      context[.imageThumbnailPixelSize] = CGSize(
        width: sdImageView.bounds.size.width * screenScale,
        height: sdImageView.bounds.size.height * screenScale
      )
    }

    context[LynxFastImageView.screenScaleKey] = screenScale
    context[LynxFastImageView.frameSizeKey] = frame.size
    context[LynxFastImageView.contentFitKey] = contentFit

    var options = loadingOptions
    if let priorityOption = priority.toSDWebImageOptions() {
      options.insert(priorityOption)
    }

    loadGeneration &+= 1
    let generation = loadGeneration

    delegate?.fastImageViewDidStartLoading(self)

    pendingOperation = imageManager.loadImage(
      with: uri,
      options: options,
      context: context,
      progress: { [weak self] receivedSize, expectedSize, imageUrl in
        self?.imageLoadProgress(receivedSize, expectedSize, imageUrl)
      },
      completed: { [weak self] image, data, error, cacheType, finished, imageUrl in
        guard let self else { return }
        // Drop completions from a superseded load: a newer `source`, a
        // size-driven reload, or `prepareForReuse` has already bumped
        // `loadGeneration` past the value captured when this request started.
        // Non-final callbacks (`finished == false`) are progress/partial and are
        // ignored here too — the fresh request will deliver its own.
        guard generation == self.loadGeneration else { return }
        self.imageLoadCompleted(image, data, error, cacheType, finished, imageUrl)
      }
    )
  }

  // MARK: - Loading

  private func imageLoadProgress(_ receivedSize: Int, _ expectedSize: Int, _ imageUrl: URL?) {
    if expectedSize <= 0 {
      return
    }
    delegate?.fastImageView(self, didUpdateProgress: receivedSize, total: expectedSize)
  }

  private func imageLoadCompleted(
    _ image: UIImage?,
    _ data: Data?,
    _ error: Error?,
    _ cacheType: SDImageCacheType,
    _ finished: Bool,
    _ imageUrl: URL?
  ) {
    if let error = error {
      let code = (error as NSError).code
      // SDWebImage reports a `cancelled` error when a newer request interrupts
      // this one — ignore it and wait for the new request.
      if code != SDWebImageError.cancelled.rawValue {
        delegate?.fastImageView(self, didFailWithError: error.localizedDescription)
      }
      return
    }
    guard finished else {
      return
    }

    guard let image else {
      displayPlaceholderIfNecessary()
      return
    }

    delegate?.fastImageView(self, didFinishLoading: [
      "cacheType": cacheTypeToString(cacheType),
      "source": [
        "url": imageUrl?.absoluteString ?? "",
        "width": image.size.width,
        "height": image.size.height,
        "mediaType": imageFormatToMediaType(image.sd_imageFormat) as Any,
        "isAnimated": image.sd_isAnimated
      ]
    ])

    let scale = screenScale
    imageLayoutSize = idealSize(
      contentPixelSize: image.size * image.scale,
      containerSize: frame.size,
      scale: scale,
      contentFit: contentFit
    )
    let imageIdealSize = imageLayoutSize.rounded(.up)
    let processed = processImage(image, idealSize: imageIdealSize, scale: scale)
    applyContentPosition(contentSize: imageLayoutSize, containerSize: frame.size)
    renderSourceImage(processed)
  }

  /// Renders a bundled app resource straight from `UIImage(named:)`, bypassing
  /// SDWebImage entirely. Returns `true` when it has taken responsibility for
  /// this load (rendered the asset, or reported a definitive miss); `false`
  /// means "not a resolvable local asset — fall through to the remote path".
  ///
  /// The delegate event contract for this synchronous branch is the design
  /// decision below: `<FastImage>` consumers still expect `loadstart` / `load`
  /// / `display` (and `error` on a bad name) to fire for a bundled source, and
  /// the `load` payload shape must match the remote path
  /// (`imageLoadCompleted`): `{ cacheType, source: { url, width, height,
  /// mediaType, isAnimated } }`.
  private func renderLocalResource(_ source: ImageSource) -> Bool {
    guard let path = localAssetName(from: source.uri) else {
      // `isBundledResource` was true but no resource name can be derived — the
      // remote loader can't salvage this either, so own the failure here.
      delegate?.fastImageView(self, didFailWithError: "Invalid bundled image path")
      return true
    }

    // A newer source may have superseded an in-flight remote load.
    cancelPendingOperation()
    delegate?.fastImageViewDidStartLoading(self)

    guard let image = UIImage(named: path) else {
      // Defined error path for the bundled scheme (PLAN §3.7): a missing asset
      // surfaces as `error`, not a confusing network failure.
      delegate?.fastImageView(self, didFailWithError: "Bundled image '\(path)' not found")
      return true
    }

    // Bundled assets live in the app binary — there is no SDWebImage cache tier
    // to report, so `cacheType` is "none" (mirrors the SF Symbol path upstream).
    delegate?.fastImageView(self, didFinishLoading: [
      "cacheType": "none",
      "source": [
        "url": source.uri?.absoluteString ?? path,
        "width": image.size.width,
        "height": image.size.height,
        "mediaType": imageFormatToMediaType(image.sd_imageFormat) as Any,
        "isAnimated": image.sd_isAnimated
      ]
    ])

    let scale = screenScale
    imageLayoutSize = idealSize(
      contentPixelSize: image.size * image.scale,
      containerSize: frame.size,
      scale: scale,
      contentFit: contentFit
    )
    let processed = processImage(image, idealSize: imageLayoutSize.rounded(.up), scale: scale)
    applyContentPosition(contentSize: imageLayoutSize, containerSize: frame.size)
    renderSourceImage(processed)  // emits `display` via `setImage`
    return true
  }

  private func localAssetImage(from source: ImageSource) -> UIImage? {
    guard let path = localAssetName(from: source.uri) else {
      return nil
    }
    return UIImage(named: path)
  }

  // MARK: - Placeholder

  var placeholderSources: [ImageSource] = [] {
    didSet {
      loadPlaceholderIfNecessary()
    }
  }

  var placeholderImage: UIImage?
  var placeholderContentFit: ContentFit = .scaleDown

  var bestPlaceholder: ImageSource? {
    return getBestSource(from: placeholderSources, forSize: bounds.size, scale: screenScale) ?? placeholderSources.first
  }

  var canDisplayPlaceholder: Bool {
    return isViewEmpty || (!hasAnySource && sourceImage == nil)
  }

  func loadPlaceholderIfNecessary() {
    guard canDisplayPlaceholder, let placeholder = bestPlaceholder else {
      return
    }

    if let localImage = localAssetImage(from: placeholder) {
      placeholderImage = localImage
      displayPlaceholderIfNecessary()
      return
    }

    guard placeholder.hasSupportedScheme, let uri = placeholder.uri else {
      return
    }

    let context = createBaseImageContext(source: placeholder, cachePolicy: .disk)
    let isPlaceholderHash = placeholder.isBlurhash || placeholder.isThumbhash

    imageManager.loadImage(with: uri, context: context, progress: nil) { [weak self] placeholderImage, _, _, _, finished, _ in
      guard let self, let placeholderImage, finished else {
        return
      }
      self.placeholderImage = placeholderImage
      self.placeholderContentFit = isPlaceholderHash ? self.contentFit : self.placeholderContentFit
      self.displayPlaceholderIfNecessary()
    }
  }

  private func displayPlaceholderIfNecessary() {
    guard canDisplayPlaceholder, let placeholder = placeholderImage else {
      return
    }
    setImage(placeholder, contentFit: placeholderContentFit, isPlaceholder: true)
  }

  // MARK: - Processing

  private func createTransformPipeline() -> SDImagePipelineTransformer? {
    let transformers: [SDImageTransformer] = [
      SDImageBlurTransformer(radius: blurRadius)
    ]
    return SDImagePipelineTransformer(transformers: transformers)
  }

  private func processImage(_ image: UIImage?, idealSize: CGSize, scale: Double) -> UIImage? {
    guard let image = image, !bounds.isEmpty else {
      return nil
    }
    sdImageView.animationTransformer = nil
    if allowDownscaling && shouldDownscale(image: image, toSize: idealSize, scale: scale) {
      if image.sd_isAnimated {
        let size = idealSize * scale
        sdImageView.animationTransformer = SDImageResizingTransformer(size: size, scaleMode: .fill)
        return image
      }
      return resize(image: image, toSize: idealSize, scale: scale)
    }
    return image
  }

  // MARK: - Rendering

  private func applyContentPosition(contentSize: CGSize, containerSize: CGSize) {
    let offset = contentPosition.offset(contentSize: contentSize, containerSize: containerSize)
    if sdImageView.layer.mask != nil {
      CATransaction.begin()
      CATransaction.setDisableActions(true)
      sdImageView.layer.frame.origin = offset
      sdImageView.layer.mask?.frame.origin = CGPoint(x: -offset.x, y: -offset.y)
      CATransaction.commit()
    } else {
      sdImageView.layer.frame.origin = offset
    }
  }

  func renderSourceImage(_ image: UIImage?) {
    sourceImage = image

    if let transition = transition, transition.duration > 0 {
      let options = transition.toAnimationOptions()
      let seconds = transition.duration / 1000

      UIView.transition(with: sdImageView, duration: seconds, options: options) { [weak self] in
        guard let self else { return }
        self.setImage(image, contentFit: self.contentFit, isPlaceholder: false)
      }
    } else {
      setImage(image, contentFit: contentFit, isPlaceholder: false)
    }
  }

  private func setImage(_ image: UIImage?, contentFit: ContentFit, isPlaceholder: Bool) {
    sdImageView.contentMode = contentFit.toContentMode()
    sdImageView.autoPlayAnimatedImage = isPlaceholder ? true : autoplay

    if let imageTintColor, !isPlaceholder {
      sdImageView.tintColor = imageTintColor
      sdImageView.image = image?.withRenderingMode(.alwaysTemplate)
    } else {
      sdImageView.tintColor = nil
      sdImageView.image = image
    }

    if !isPlaceholder {
      delegate?.fastImageViewDidDisplay(self)
    }
  }

  // MARK: - Helpers

  @objc public func cancelPendingOperation() {
    pendingOperation?.cancel()
    pendingOperation = nil
    // Invalidate any completion still in flight from SDWebImage (cancellation
    // is not instantaneous).
    loadGeneration &+= 1
  }

  var screenScale: Double {
    return Double(window?.screen.scale ?? UIScreen.main.scale)
  }

  var bestSource: ImageSource? {
    return getBestSource(from: sources, forSize: bounds.size, scale: screenScale)
  }

  var isViewEmpty: Bool {
    return sdImageView.image == nil
  }

  var hasAnySource: Bool {
    return sources?.isEmpty == false
  }

  private func createBaseImageContext(source: ImageSource, cachePolicy: ImageCachePolicy? = nil) -> SDWebImageContext {
    var context = createSDWebImageContext(
      forSource: source,
      cachePolicy: cachePolicy ?? self.cachePolicy
    )
    context[LynxFastImageView.screenScaleKey] = screenScale
    return context
  }

  // MARK: - Coders

  private static var didRegisterCoders = false

  /// Register the WebP coder once per process. Idempotent when Expo Image (or
  /// anyone else) has already added the same coder class.
  private static func registerCodersIfNeeded() {
    guard !didRegisterCoders else { return }
    didRegisterCoders = true

    let manager = SDImageCodersManager.shared
    let webpCoder = SDImageAWebPCoder.shared
    let alreadyRegistered = (manager.coders ?? []).contains { type(of: $0) == type(of: webpCoder) }
    if !alreadyRegistered {
      manager.addCoder(webpCoder)
    }
  }
}

func localAssetName(from url: URL?) -> String? {
  guard let url else {
    return nil
  }
  if let scheme = url.scheme, scheme != "file" {
    return nil
  }
  var path = url.relativePath
  if path.hasPrefix("/") {
    path.removeFirst()
  }
  return path.isEmpty ? nil : path
}
