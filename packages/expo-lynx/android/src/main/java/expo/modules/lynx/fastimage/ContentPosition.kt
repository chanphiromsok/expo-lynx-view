package expo.modules.lynx.fastimage

import android.graphics.Matrix
import android.graphics.RectF

/**
 * Ported from expo-image 57.0.4 (android .../image/records/ContentPosition.kt).
 * `Record`/`@Field` are dropped; `from(...)` parses the JSON the <FastImage>
 * wrapper serializes ({ top|bottom|left|right: number | "50%" | "center" }).
 */
typealias ContentPositionValue = Any // Double or String

class ContentPosition(
  private val top: ContentPositionValue? = null,
  private val bottom: ContentPositionValue? = null,
  private val left: ContentPositionValue? = null,
  private val right: ContentPositionValue? = null
) {
  private fun ContentPositionValue?.calcOffset(
    isReverse: Boolean,
    imageRect: RectF,
    viewRect: RectF,
    calcAxisOffset: (Float, RectF, RectF, Boolean, Boolean) -> Float
  ): Float? {
    if (this == null) return null
    return when (this) {
      is Double -> calcAxisOffset(this.toFloat(), imageRect, viewRect, false, isReverse)
      is Int -> calcAxisOffset(this.toFloat(), imageRect, viewRect, false, isReverse)
      is String -> {
        if (this == "center") {
          calcAxisOffset(50f, imageRect, viewRect, true, isReverse)
        } else {
          calcAxisOffset(this.removeSuffix("%").toFloat(), imageRect, viewRect, true, isReverse)
        }
      }
      else -> null
    }
  }

  private fun offsetX(imageRect: RectF, viewRect: RectF): Float =
    left.calcOffset(false, imageRect, viewRect, ::calcXTranslation)
      ?: right.calcOffset(true, imageRect, viewRect, ::calcXTranslation)
      ?: calcXTranslation(50f, imageRect, viewRect, isPercentage = true)

  private fun offsetY(imageRect: RectF, viewRect: RectF): Float =
    top.calcOffset(false, imageRect, viewRect, ::calcYTranslation)
      ?: bottom.calcOffset(true, imageRect, viewRect, ::calcYTranslation)
      ?: calcYTranslation(50f, imageRect, viewRect, isPercentage = true)

  fun apply(to: Matrix, imageRect: RectF, viewRect: RectF) {
    to.postTranslate(offsetX(imageRect, viewRect), offsetY(imageRect, viewRect))
  }

  companion object {
    val center = ContentPosition()

    @Suppress("UNCHECKED_CAST")
    fun from(map: Map<String, Any?>?): ContentPosition {
      if (map == null) return center
      return ContentPosition(
        top = map["top"],
        bottom = map["bottom"],
        left = map["left"],
        right = map["right"]
      )
    }
  }
}
