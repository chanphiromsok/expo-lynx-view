export { FastImage } from './FastImage';
export type {
  FastImageProps,
  FastImageSource,
  FastImageContentFit,
  FastImageContentPosition,
  FastImageTransition,
  FastImagePriority,
  FastImageCachePolicy,
  FastImageDecodeFormat,
  FastImageLoadEvent,
  FastImageProgressEvent,
  FastImageErrorEvent,
} from './FastImage';

// This package is JS-only: it emits <x-lynx-fast-image> and nothing else.
// The native element (SDWebImage on iOS, Glide on Android) is provided by the
// Lynx host — see expo-lynx-view (ios/FastImage/). A host that doesn't
// register "x-lynx-fast-image" will simply render nothing for <FastImage>.
// Cache / prefetch APIs, when added, belong to the host module, not here.
