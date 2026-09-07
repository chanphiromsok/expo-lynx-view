package expo.modules.lynx.fastimage

import android.graphics.Matrix
import android.graphics.RectF
import kotlin.math.max

/**
 * Ported from expo-image 57.0.4 (android .../image/enums/ContentFit.kt).
 * Mirrors the CSS `object-fit` property. `Enumerable` (an Expo Modules type)
 * is dropped in favour of a plain `from(...)` parser.
 */
enum class ContentFit(val value: String) {
  Contain("contain"),
  Cover("cover"),
  Fill("fill"),
  None("none"),
  ScaleDown("scale-down");

  fun toMatrix(imageRect: RectF, viewRect: RectF, sourceWidth: Int, sourceHeight: Int): Matrix = Matrix().apply {
    when (this@ContentFit) {
      Contain -> setRectToRect(imageRect, viewRect, Matrix.ScaleToFit.START)
      Cover -> {
        val scale = max(viewRect.width() / imageRect.width(), viewRect.height() / imageRect.height())
        setScale(scale, scale)
      }
      Fill -> setRectToRect(imageRect, viewRect, Matrix.ScaleToFit.FILL)
      None -> {
        // no scaling
      }
      ScaleDown -> {
        if (sourceWidth != -1 && sourceHeight != -1) {
          val sourceRect = RectF(0f, 0f, sourceWidth.toFloat(), sourceHeight.toFloat())
          if (sourceRect.width() >= viewRect.width() || sourceRect.height() >= viewRect.height()) {
            setRectToRect(imageRect, viewRect, Matrix.ScaleToFit.START)
          } else {
            setRectToRect(imageRect, sourceRect, Matrix.ScaleToFit.START)
          }
        } else if (imageRect.width() >= viewRect.width() || imageRect.height() >= viewRect.height()) {
          setRectToRect(imageRect, viewRect, Matrix.ScaleToFit.START)
        }
      }
    }
  }

  companion object {
    fun from(value: String?): ContentFit =
      entries.firstOrNull { it.value == value } ?: Cover
  }
}
