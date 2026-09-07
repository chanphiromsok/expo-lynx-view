#import <UIKit/UIKit.h>
#import <Lynx/LynxUI.h>

NS_ASSUME_NONNULL_BEGIN

/// Custom Lynx element `<x-lynx-fast-image>`.
///
/// A plain custom native component (modeled on Lynx Explorer's `LynxExplorerInput`):
/// it does NOT implement `LynxServiceImageProtocol` and never routes a request
/// through Lynx's built-in `<image>` pipeline. Rendering is backed directly by
/// SDWebImage through the Swift `LynxFastImageView` (ported from Expo Image 57.0.4).
///
/// The element is NOT self-registering. The host registers it on its
/// `LynxViewBuilder` config, exactly as Explorer does for `explorer-input`:
///
///     [builder.config registerUI:LynxFastImageElement.class withName:@"x-lynx-fast-image"];
///
/// The generic parameter stays `UIView *` so this public header never imports the
/// generated `-Swift.h`; the implementation casts `self.view` to the Swift view.
@interface LynxFastImageElement : LynxUI <UIView *>

@end

NS_ASSUME_NONNULL_END
