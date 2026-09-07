package expo.modules.lynx.fastimage

import android.graphics.RectF

// Ported from expo-image 57.0.4 (android .../image/ImageUtils.kt).
// Only the content-position translation helpers are kept; the rest of that
// file is Glide-request plumbing folded into LynxFastImageUI.

fun calcXTranslation(
  value: Float,
  imageRect: RectF,
  viewRect: RectF,
  isPercentage: Boolean = false,
  isReverse: Boolean = false
): Float = calcTranslation(value, imageRect.width(), viewRect.width(), isPercentage, isReverse)

fun calcYTranslation(
  value: Float,
  imageRect: RectF,
  viewRect: RectF,
  isPercentage: Boolean = false,
  isReverse: Boolean = false
): Float = calcTranslation(value, imageRect.height(), viewRect.height(), isPercentage, isReverse)

fun calcTranslation(
  value: Float,
  imageRefValue: Float,
  viewRefValue: Float,
  isPercentage: Boolean = false,
  isReverse: Boolean = false
): Float {
  if (isPercentage) {
    val finalPercentage = if (isReverse) 100f - value else value
    return (finalPercentage / 100f) * (viewRefValue - imageRefValue)
  }
  if (isReverse) {
    return viewRefValue - imageRefValue - value
  }
  return value
}
