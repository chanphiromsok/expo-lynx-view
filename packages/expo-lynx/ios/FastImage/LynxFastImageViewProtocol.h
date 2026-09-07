// Pure Obj-C contract between the `LynxUI` wrapper (`LynxFastImageElement`, must
// be Obj-C for the Lynx C macros) and the Swift `LynxFastImageView`.
//
// Keeping this in plain Obj-C means `LynxFastImageElement.m` never imports the
// generated `<module>-Swift.h`, which sidesteps the Swift/Obj-C header ordering
// problems in a mixed-language CocoaPods module. Swift sees these protocols for
// free (Obj-C headers of the same module are always visible to its Swift).

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@protocol LynxFastImageViewDelegate <NSObject>
- (void)fastImageViewDidStartLoading:(UIView *)view;
- (void)fastImageView:(UIView *)view didUpdateProgress:(NSInteger)loaded total:(NSInteger)total;
- (void)fastImageView:(UIView *)view didFinishLoading:(NSDictionary<NSString *, id> *)info;
- (void)fastImageViewDidDisplay:(UIView *)view;
- (void)fastImageView:(UIView *)view didFailWithError:(NSString *)error;
@end

/// Implemented by the Swift `LynxFastImageView`.
@protocol LynxFastImageViewBridge <NSObject>

@property(nonatomic, weak, nullable) id<LynxFastImageViewDelegate> delegate;

@property(nonatomic, copy, nullable) NSString *recyclingKey;
@property(nonatomic) CGFloat blurRadius;
@property(nonatomic, strong, nullable) UIColor *imageTintColor;
@property(nonatomic) BOOL allowDownscaling;
@property(nonatomic) BOOL autoplay;

- (void)cancelPendingOperation;
- (void)startAnimating;
- (void)stopAnimating;
- (void)prepareForReuse;

- (void)applySourcesFromJSONValues:(NSArray<NSDictionary *> *)values;
- (void)applyPlaceholderFromJSONValues:(NSArray<NSDictionary *> *)values;
- (void)applyContentPositionFromJSONValue:(nullable id)value;
- (void)applyTransitionFromJSONValue:(nullable id)value;
- (void)applyContentFit:(nullable NSString *)value;
- (void)applyPlaceholderContentFit:(nullable NSString *)value;
- (void)applyCachePolicy:(nullable NSString *)value;
- (void)applyPriority:(nullable NSString *)value;

@end

NS_ASSUME_NONNULL_END
