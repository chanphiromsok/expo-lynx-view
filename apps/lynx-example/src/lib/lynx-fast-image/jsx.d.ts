// Teaches TypeScript about the raw `<x-lynx-fast-image>` host element so both
// this package's `FastImage` wrapper and any consumer using the tag directly
// type-check. Loaded via a triple-slash reference from `FastImage.tsx`.
//
// The `<FastImage>` wrapper is the supported surface — it serializes
// source / placeholder / contentPosition / transition and converts a `style`
// object to a CSS string. The raw tag mirrors the native prop setters: kebab-
// case attribute names, a plain-string `source`, a CSS-string `style`, and
// JSON strings for the complex props.

import type { ReactNode } from '@lynx-js/react';
import type {
  FastImageErrorEvent,
  FastImageLoadEvent,
  FastImageProgressEvent,
} from './FastImage';

interface RawFastImageAttributes {
  source?: string;
  placeholder?: string;
  'content-fit'?: string;
  'placeholder-content-fit'?: string;
  'content-position'?: string;
  'image-transition'?: string | number;
  'blur-radius'?: number;
  'tint-color'?: string;
  priority?: string;
  'cache-policy'?: string;
  'recycling-key'?: string;
  'allow-downscaling'?: boolean;
  autoplay?: boolean;
  'decode-format'?: string;
  'accessibility-label'?: string;
  style?: string;
  class?: string;
  className?: string;
  id?: string;
  children?: ReactNode;
  bindloadstart?: () => void;
  bindprogress?: (event: FastImageProgressEvent) => void;
  bindload?: (event: FastImageLoadEvent) => void;
  binddisplay?: () => void;
  binderror?: (event: FastImageErrorEvent) => void;
}

declare module '@lynx-js/react/jsx-runtime' {
  export namespace JSX {
    interface IntrinsicElements {
      'x-lynx-fast-image': RawFastImageAttributes;
    }
  }
}

declare module '@lynx-js/react/jsx-dev-runtime' {
  export namespace JSX {
    interface IntrinsicElements {
      'x-lynx-fast-image': RawFastImageAttributes;
    }
  }
}
