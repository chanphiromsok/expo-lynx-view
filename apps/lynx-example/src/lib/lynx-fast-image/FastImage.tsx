/// <reference path="./jsx.d.ts" />
import type { ReactNode } from '@lynx-js/react';

/**
 * Public, Lynx-native surface for `<x-lynx-fast-image>`.
 *
 * Deliberately does NOT re-export React Native types (`ViewProps`, `StyleProp`,
 * asset ids, `SharedRef`) — those are not Lynx contracts. Complex props
 * (`source`, `placeholder`, `contentPosition`, `transition`) are serialized to
 * JSON here and decoded at the native trust boundary (PLAN §2).
 */

export type FastImageSource =
  | string
  | {
      uri: string;
      headers?: Record<string, string>;
      cacheKey?: string;
      width?: number;
      height?: number;
    };

export type FastImageContentFit =
  | 'cover'
  | 'contain'
  | 'fill'
  | 'none'
  | 'scale-down';

export type FastImageContentPosition = {
  top?: number | string;
  bottom?: number | string;
  left?: number | string;
  right?: number | string;
};

export type FastImageTransition =
  | number
  | {
      duration?: number;
      timing?: 'ease-in-out' | 'ease-in' | 'ease-out' | 'linear';
      effect?:
        | 'cross-dissolve'
        | 'flip-from-top'
        | 'flip-from-right'
        | 'flip-from-bottom'
        | 'flip-from-left'
        | 'curl-up'
        | 'curl-down';
    };

export type FastImagePriority = 'low' | 'normal' | 'high';

export type FastImageCachePolicy = 'none' | 'disk' | 'memory' | 'memory-disk';

export type FastImageDecodeFormat = 'argb' | 'rgb';

export interface FastImageLoadEvent {
  detail: {
    source: {
      url: string;
      width: number;
      height: number;
      mediaType?: string | null;
    };
    cacheType?: 'none' | 'disk' | 'memory';
  };
}

export interface FastImageProgressEvent {
  detail: { loaded: number; total: number; progress: number };
}

export interface FastImageErrorEvent {
  detail: { error: string };
}

export interface FastImageProps {
  source?: FastImageSource | FastImageSource[] | null;
  placeholder?: FastImageSource | FastImageSource[] | null;
  contentFit?: FastImageContentFit;
  placeholderContentFit?: FastImageContentFit;
  contentPosition?: FastImageContentPosition;
  transition?: FastImageTransition | null;
  blurRadius?: number;
  tintColor?: string | null;
  priority?: FastImagePriority;
  cachePolicy?: FastImageCachePolicy;
  recyclingKey?: string | null;
  allowDownscaling?: boolean;
  autoplay?: boolean;
  decodeFormat?: FastImageDecodeFormat;
  accessibilityLabel?: string;

  className?: string;
  style?: Record<string, unknown> | string;

  onLoadStart?: () => void;
  onProgress?: (event: FastImageProgressEvent) => void;
  onLoad?: (event: FastImageLoadEvent) => void;
  onDisplay?: () => void;
  onError?: (event: FastImageErrorEvent) => void;

  children?: ReactNode;
}

function serialize(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }
  return JSON.stringify(value);
}

/**
 * `<x-lynx-fast-image>` is a host custom element, so ReactLynx cannot
 * compile a `style={{ ... }}` object literal into a CSS string the way it does
 * for intrinsic tags — it forwards the raw object, and native
 * `__SetInlineStyles` then iterates it expecting `[styleId, value]` pairs and
 * calls `-count` on a string key (`-[NSTaggedPointerString count]` crash in
 * CreatePaintingNode). Convert to a CSS string here.
 */
function toStyleString(style?: Record<string, unknown> | string): string | undefined {
  if (style == null) {
    return undefined;
  }
  if (typeof style === 'string') {
    return style;
  }
  const parts: string[] = [];
  for (const key of Object.keys(style)) {
    const value = style[key];
    if (value == null) {
      continue;
    }
    const prop = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
    parts.push(`${prop}:${String(value)}`);
  }
  return parts.length > 0 ? parts.join(';') : undefined;
}

function normalizeTintColor(color?: string | null): string | undefined {
  if (!color) {
    return undefined;
  }
  // The native side accepts `#RRGGBB` / `#AARRGGBB`. Pass named/other formats
  // through untouched so the host can still attempt to parse them.
  return color;
}

export function FastImage(props: FastImageProps): ReactNode {
  const {
    source,
    placeholder,
    contentFit,
    placeholderContentFit,
    contentPosition,
    transition,
    blurRadius,
    tintColor,
    priority,
    cachePolicy,
    recyclingKey,
    allowDownscaling,
    autoplay,
    decodeFormat,
    accessibilityLabel,
    className,
    style,
    onLoadStart,
    onProgress,
    onLoad,
    onDisplay,
    onError,
    children,
  } = props;

  // Every prop is a literal JSX attribute — never a `{...spread}`, which would
  // route `bindxxx` through ReactLynx's dynamic path instead of a real event
  // binding.
  return (
    <x-lynx-fast-image
      source={serialize(source)}
      placeholder={serialize(placeholder)}
      content-position={serialize(contentPosition)}
      image-transition={serialize(transition)}
      content-fit={contentFit}
      placeholder-content-fit={placeholderContentFit}
      blur-radius={blurRadius}
      tint-color={normalizeTintColor(tintColor)}
      priority={priority}
      cache-policy={cachePolicy}
      recycling-key={recyclingKey ?? undefined}
      allow-downscaling={allowDownscaling}
      autoplay={autoplay}
      decode-format={decodeFormat}
      accessibility-label={accessibilityLabel}
      className={className}
      style={toStyleString(style)}
      bindloadstart={onLoadStart}
      bindprogress={onProgress}
      bindload={onLoad}
      binddisplay={onDisplay}
      binderror={onError}
    >
      {children}
    </x-lynx-fast-image>
  );
}
