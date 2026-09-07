#import "LynxFastImageElement.h"
#import "LynxFastImageViewProtocol.h"

#import <Lynx/LynxPropsProcessor.h>
#import <Lynx/LynxUIMethodProcessor.h>
#import <Lynx/LynxEventEmitter.h>
#import <Lynx/LynxEvent.h>

typedef UIView<LynxFastImageViewBridge> LynxFastImageBackingView;

@interface LynxFastImageElement () <LynxFastImageViewDelegate>
@end

@implementation LynxFastImageElement {
  NSArray<NSDictionary *> *_pendingSources;
  BOOL _sourcesDirty;
}

// Not self-registering — the host calls
// `[builder.config registerUI:LynxFastImageElement.class withName:@"x-lynx-fast-image"]`,
// mirroring Lynx Explorer's `LynxExplorerInput`.

- (UIView *)createView {
  // Instantiate the Swift view by runtime name so this file never imports the
  // generated `<module>-Swift.h`.
  Class viewClass = NSClassFromString(@"LynxFastImageView");
  LynxFastImageBackingView *view = [[viewClass alloc] initWithFrame:CGRectZero];
  view.delegate = self;
  return view;
}

/// `self.view` is typed `UIView *` (see header). This is the real view.
- (LynxFastImageBackingView *)imageView {
  return (LynxFastImageBackingView *)self.view;
}

#pragma mark - Lifecycle

- (void)propsDidUpdate {
  [super propsDidUpdate];
  if (_sourcesDirty) {
    _sourcesDirty = NO;
    [self.imageView applySourcesFromJSONValues:_pendingSources ?: @[]];
  }
}

- (void)willMoveToWindow:(UIWindow *)window {
  [super willMoveToWindow:window];
  if (window == nil) {
    [self.imageView cancelPendingOperation];
  }
}

- (void)onListCellPrepareForReuse:(NSString *)itemKey withList:(LynxUI *)list {
  [super onListCellPrepareForReuse:itemKey withList:list];
  [self.imageView prepareForReuse];
}

- (void)onListCellDisappear:(NSString *)itemKey exist:(BOOL)isExist withList:(LynxUI *)list {
  [super onListCellDisappear:itemKey exist:isExist withList:list];
  [self.imageView cancelPendingOperation];
}

#pragma mark - Complex props (serialized as JSON at the wrapper — PLAN §2)

LYNX_PROP_SETTER("source", setSource, NSString *) {
  _pendingSources = (requestReset || value == nil) ? @[] : [LynxFastImageElement decodeSourceList:value];
  _sourcesDirty = YES;
}

LYNX_PROP_SETTER("placeholder", setPlaceholder, NSString *) {
  NSArray<NSDictionary *> *list = (requestReset || value == nil) ? @[] : [LynxFastImageElement decodeSourceList:value];
  [self.imageView applyPlaceholderFromJSONValues:list];
}

LYNX_PROP_SETTER("content-position", setContentPosition, NSString *) {
  id decoded = (requestReset || value == nil) ? nil : [LynxFastImageElement decodeJSON:value];
  [self.imageView applyContentPositionFromJSONValue:decoded];
}

LYNX_PROP_SETTER("image-transition", setTransition, NSString *) {
  id decoded = (requestReset || value == nil) ? nil : [LynxFastImageElement decodeJSON:value];
  [self.imageView applyTransitionFromJSONValue:decoded];
}

#pragma mark - Scalar props

LYNX_PROP_SETTER("content-fit", setContentFit, NSString *) {
  [self.imageView applyContentFit:requestReset ? nil : value];
}

LYNX_PROP_SETTER("placeholder-content-fit", setPlaceholderContentFit, NSString *) {
  [self.imageView applyPlaceholderContentFit:requestReset ? nil : value];
}

LYNX_PROP_SETTER("cache-policy", setCachePolicy, NSString *) {
  [self.imageView applyCachePolicy:requestReset ? nil : value];
}

LYNX_PROP_SETTER("priority", setPriority, NSString *) {
  [self.imageView applyPriority:requestReset ? nil : value];
}

LYNX_PROP_SETTER("recycling-key", setRecyclingKey, NSString *) {
  self.imageView.recyclingKey = requestReset ? nil : value;
}

LYNX_PROP_SETTER("blur-radius", setBlurRadius, CGFloat) {
  self.imageView.blurRadius = requestReset ? 0 : MAX(0, value);
}

LYNX_PROP_SETTER("tint-color", setTintColor, NSString *) {
  self.imageView.imageTintColor = requestReset ? nil : [LynxFastImageElement colorFromString:value];
}

LYNX_PROP_SETTER("allow-downscaling", setAllowDownscaling, BOOL) {
  self.imageView.allowDownscaling = requestReset ? YES : value;
}

LYNX_PROP_SETTER("autoplay", setAutoplay, BOOL) {
  self.imageView.autoplay = requestReset ? YES : value;
}

LYNX_PROP_SETTER("decode-format", setDecodeFormat, NSString *) {
  // Android-only hint; accepted for API parity, ignored on iOS.
}

LYNX_PROP_SETTER("accessibility-label", setAccessibilityLabelProp, NSString *) {
  self.imageView.isAccessibilityElement = !requestReset && value.length > 0;
  self.imageView.accessibilityLabel = requestReset ? nil : value;
}

#pragma mark - UI methods

LYNX_UI_METHOD(startAnimating) {
  [self.imageView startAnimating];
  callback(kUIMethodSuccess, nil);
}

LYNX_UI_METHOD(stopAnimating) {
  [self.imageView stopAnimating];
  callback(kUIMethodSuccess, nil);
}

#pragma mark - LynxFastImageViewDelegate

- (void)fastImageViewDidStartLoading:(UIView *)view {
  [self emitEvent:@"loadstart" detail:@{}];
}

- (void)fastImageView:(UIView *)view didUpdateProgress:(NSInteger)loaded total:(NSInteger)total {
  double progress = total > 0 ? (double)loaded / (double)total : 0;
  [self emitEvent:@"progress" detail:@{@"loaded" : @(loaded), @"total" : @(total), @"progress" : @(progress)}];
}

- (void)fastImageView:(UIView *)view didFinishLoading:(NSDictionary<NSString *, id> *)info {
  [self emitEvent:@"load" detail:info];
}

- (void)fastImageViewDidDisplay:(UIView *)view {
  [self emitEvent:@"display" detail:@{}];
}

- (void)fastImageView:(UIView *)view didFailWithError:(NSString *)error {
  [self emitEvent:@"error" detail:@{@"error" : error ?: @"unknown"}];
}

- (void)emitEvent:(NSString *)name detail:(NSDictionary *)detail {
  LynxCustomEvent *event = [[LynxDetailEvent alloc] initWithName:name targetSign:self.sign detail:detail];
  [self.context.eventEmitter dispatchCustomEvent:event];
}

#pragma mark - Decoding helpers

+ (nullable id)decodeJSON:(NSString *)value {
  if (value.length == 0) {
    return nil;
  }
  NSData *data = [value dataUsingEncoding:NSUTF8StringEncoding];
  if (data == nil) {
    return nil;
  }
  NSError *error = nil;
  id result = [NSJSONSerialization JSONObjectWithData:data
                                             options:NSJSONReadingFragmentsAllowed
                                               error:&error];
  return error ? nil : result;
}

/// Normalizes the decoded `source` / `placeholder` value into an array of
/// dictionaries (or `{ "uri": "..." }` for bare strings). Accepts both the JSON
/// the `<FastImage>` wrapper serializes AND a plain URL string passed straight
/// to the raw `<x-lynx-fast-image>` tag.
+ (NSArray<NSDictionary *> *)decodeSourceList:(NSString *)value {
  id decoded = [self decodeJSON:value];
  if (decoded == nil) {
    // Not JSON — treat the attribute value itself as a single URI.
    NSString *uri = [value stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    return uri.length > 0 ? @[ @{@"uri" : uri} ] : @[];
  }
  NSMutableArray<NSDictionary *> *list = [NSMutableArray array];
  NSArray *items = [decoded isKindOfClass:[NSArray class]] ? decoded : @[ decoded ];
  for (id item in items) {
    if ([item isKindOfClass:[NSString class]]) {
      if (((NSString *)item).length > 0) {
        [list addObject:@{@"uri" : item}];
      }
    } else if ([item isKindOfClass:[NSDictionary class]]) {
      [list addObject:item];
    }
  }
  return list;
}

+ (nullable UIColor *)colorFromString:(NSString *)value {
  if (value.length == 0) {
    return nil;
  }
  NSString *hex = [value hasPrefix:@"#"] ? [value substringFromIndex:1] : value;
  unsigned long long raw = 0;
  if (![[NSScanner scannerWithString:hex] scanHexLongLong:&raw]) {
    return nil;
  }
  CGFloat r, g, b, a;
  if (hex.length == 8) { // AARRGGBB
    a = ((raw & 0xFF000000) >> 24) / 255.0;
    r = ((raw & 0x00FF0000) >> 16) / 255.0;
    g = ((raw & 0x0000FF00) >> 8) / 255.0;
    b = (raw & 0x000000FF) / 255.0;
  } else { // RRGGBB
    a = 1.0;
    r = ((raw & 0xFF0000) >> 16) / 255.0;
    g = ((raw & 0x00FF00) >> 8) / 255.0;
    b = (raw & 0x0000FF) / 255.0;
  }
  return [UIColor colorWithRed:r green:g blue:b alpha:a];
}

@end
