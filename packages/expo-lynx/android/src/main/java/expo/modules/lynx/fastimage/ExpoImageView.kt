package expo.modules.lynx.fastimage

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.PorterDuff
import android.graphics.RectF
import android.graphics.drawable.Drawable
import android.widget.ImageView
import androidx.core.graphics.transform

/**
 * Ported from expo-image 57.0.4 (android .../image/ExpoImageView.kt).
 *
 * The single matrix-transformed image view. Upstream extends
 * `AppCompatImageView`; expo-lynx-view has no appcompat dependency, and plain
 * `ImageView` already gives us `MATRIX` scale type + color filter on the
 * supported API range. Upstream's two-view crossfade wrapper
 * (`ExpoImageViewWrapper`) and Glide `Target` bookkeeping are not ported yet —
 * `LynxFastImageUI` drives one of these directly and lets Glide's
 * `DrawableTransitionOptions` handle the fade (PLAN §4: start with one view).
 */
@SuppressLint("ViewConstructor", "AppCompatCustomView")
class ExpoImageView(context: Context) : ImageView(context) {

  init {
    clipToOutline = true
    scaleType = ScaleType.MATRIX
  }

  var contentFit: ContentFit = ContentFit.Cover
    set(value) { field = value; applyTransformationMatrix() }

  var contentPosition: ContentPosition = ContentPosition.center
    set(value) { field = value; applyTransformationMatrix() }

  /** Intrinsic source size, when known — sharpens `scale-down`. */
  var sourceWidth: Int = -1
  var sourceHeight: Int = -1

  fun setTintColor(color: Int?) {
    color?.let { setColorFilter(it, PorterDuff.Mode.SRC_IN) } ?: clearColorFilter()
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    super.onLayout(changed, l, t, r, b)
    applyTransformationMatrix()
  }

  override fun setImageDrawable(drawable: Drawable?) {
    super.setImageDrawable(drawable)
    applyTransformationMatrix()
  }

  fun applyTransformationMatrix() {
    val d = drawable ?: return
    if (width == 0 || height == 0 || d.intrinsicWidth <= 0 || d.intrinsicHeight <= 0) return

    val imageRect = RectF(0f, 0f, d.intrinsicWidth.toFloat(), d.intrinsicHeight.toFloat())
    val viewRect = RectF(0f, 0f, width.toFloat(), height.toFloat())

    val matrix = contentFit.toMatrix(imageRect, viewRect, sourceWidth, sourceHeight)
    val scaledImageRect = imageRect.transform(matrix)
    imageMatrix = matrix.apply { contentPosition.apply(this, scaledImageRect, viewRect) }
  }

  fun clear() {
    setImageDrawable(null)
    clearColorFilter()
    sourceWidth = -1
    sourceHeight = -1
  }
}
