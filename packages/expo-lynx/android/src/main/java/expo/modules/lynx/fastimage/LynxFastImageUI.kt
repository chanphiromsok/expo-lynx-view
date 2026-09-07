package expo.modules.lynx.fastimage

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.Drawable
import com.bumptech.glide.Glide
import com.bumptech.glide.load.DataSource
import com.bumptech.glide.load.engine.GlideException
import com.bumptech.glide.load.resource.drawable.DrawableTransitionOptions
import com.bumptech.glide.request.RequestListener
import com.bumptech.glide.request.RequestOptions
import com.bumptech.glide.request.target.Target
import com.lynx.tasm.behavior.LynxContext
import com.lynx.tasm.behavior.LynxProp
import com.lynx.tasm.behavior.ui.LynxUI
import com.lynx.tasm.behavior.ui.list.UIList
import com.lynx.tasm.behavior.ui.LynxBaseUI
import com.lynx.tasm.event.LynxCustomEvent
import org.json.JSONArray
import org.json.JSONObject

/**
 * `<x-lynx-fast-image>` — renders through Glide. The <FastImage> ReactLynx
 * wrapper serializes `source` / `placeholder` / `content-position` /
 * `image-transition` to JSON strings; scalars arrive as-is.
 *
 * Behavior contract mirrors the iOS element (ios/FastImage/): prop names,
 * event names (`loadstart` / `load` / `display` / `error`), and the Expo-Image
 * `load` payload shape.
 */
class LynxFastImageUI(context: LynxContext) : LynxUI<ExpoImageView>(context) {

  private var pendingSource: SourceMap? = null
  private var sourceDirty = false

  private var priority = ImagePriority.NORMAL
  private var cachePolicy = ImageCachePolicy.MEMORY_AND_DISK
  private var recyclingKey: String? = null
  private var allowDownscaling = true
  private var transitionDurationMs = 0
  private var decodeFormat: ImageDecodeFormat? = null

  private var currentModelKey: String? = null
  private var loadGeneration = 0

  override fun createView(context: Context): ExpoImageView = ExpoImageView(context)

  // region props

  @LynxProp(name = "source")
  fun setSource(value: String?) {
    pendingSource = value?.let(::parseSource)
    sourceDirty = true
  }

  @LynxProp(name = "content-fit")
  fun setContentFit(value: String?) {
    mView.contentFit = ContentFit.from(value)
  }

  @LynxProp(name = "content-position")
  fun setContentPosition(value: String?) {
    mView.contentPosition = ContentPosition.from(value?.let(::jsonToMap))
  }

  @LynxProp(name = "tint-color")
  fun setTintColor(value: String?) {
    mView.setTintColor(value?.let { runCatching { Color.parseColor(it) }.getOrNull() })
  }

  @LynxProp(name = "priority")
  fun setPriority(value: String?) {
    priority = ImagePriority.from(value)
  }

  @LynxProp(name = "cache-policy")
  fun setCachePolicy(value: String?) {
    cachePolicy = ImageCachePolicy.from(value)
  }

  @LynxProp(name = "recycling-key")
  fun setRecyclingKey(value: String?) {
    if (recyclingKey != null && recyclingKey != value) {
      // A recycled cell bound to a new logical item — drop the old image now
      // so it can't flash before the new one decodes.
      cancel()
      mView.clear()
    }
    recyclingKey = value
  }

  @LynxProp(name = "allow-downscaling")
  fun setAllowDownscaling(value: Boolean) {
    allowDownscaling = value
  }

  @LynxProp(name = "image-transition")
  fun setImageTransition(value: String?) {
    transitionDurationMs = value?.let { jsonToMap(it)?.get("duration") as? Number }?.toInt() ?: 0
  }

  @LynxProp(name = "decode-format")
  fun setDecodeFormat(value: String?) {
    decodeFormat = ImageDecodeFormat.from(value)
  }

  @LynxProp(name = "accessibility-label")
  fun setAccessibilityLabelProp(value: String?) {
    mView.contentDescription = value
  }

  // endregion

  override fun onPropsUpdated() {
    super.onPropsUpdated()
    if (sourceDirty) {
      sourceDirty = false
      reload()
    }
  }

  override fun onLayoutUpdated() {
    super.onLayoutUpdated()
    // A remote request built before the view had a size was loaded at a
    // fallback resolution; rebuild it now that we can downsample to fit.
    if (currentModelKey != null && width > 0 && height > 0) {
      reload()
    }
    mView.applyTransformationMatrix()
  }

  // region list recycling / teardown

  override fun onListCellAppear(itemKey: String?, list: UIList?) {
    super.onListCellAppear(itemKey, list)
    if (currentModelKey == null && pendingSource != null) reload()
  }

  override fun onListCellDisAppear(itemKey: String?, list: LynxBaseUI?, isExist: Boolean) {
    super.onListCellDisAppear(itemKey, list, isExist)
    cancel()
  }

  override fun destroy() {
    cancel()
    mView.clear()
    super.destroy()
  }

  // endregion

  private fun reload() {
    val context = mView.context
    val source = pendingSource
    if (source == null) {
      cancel()
      mView.clear()
      currentModelKey = null
      return
    }

    val model = source.toGlideModel(context)
    if (model == null) {
      emit("error", mapOf("error" to "Unsupported or empty image source"))
      return
    }

    cancel()
    loadGeneration += 1
    val generation = loadGeneration
    currentModelKey = model.toString()

    val target = resolveTargetSize(source)

    var options = RequestOptions()
      .priority(priority.toGlidePriority())
      .diskCacheStrategy(cachePolicy.toDiskCacheStrategy())
      .skipMemoryCache(cachePolicy.skipMemoryCache())
      .apply { source.toGlideOptions().let { this.apply(it) } }
    decodeFormat?.let { options = options.format(it.toGlideFormat()) }
    if (target != null) options = options.override(target.first, target.second)

    emit("loadstart", emptyMap())

    var builder = Glide.with(mView).load(model).apply(options)
    if (transitionDurationMs > 0) {
      builder = builder.transition(DrawableTransitionOptions.withCrossFade(transitionDurationMs))
    }
    builder.listener(object : RequestListener<Drawable> {
      override fun onLoadFailed(
        e: GlideException?, m: Any?, t: Target<Drawable>, isFirst: Boolean
      ): Boolean {
        if (generation != loadGeneration) return false
        emit("error", mapOf("error" to (e?.message ?: "Image load failed")))
        return false
      }

      override fun onResourceReady(
        resource: Drawable, m: Any, t: Target<Drawable>, dataSource: DataSource, isFirst: Boolean
      ): Boolean {
        if (generation != loadGeneration) return false
        mView.sourceWidth = resource.intrinsicWidth
        mView.sourceHeight = resource.intrinsicHeight
        emit(
          "load",
          mapOf(
            "cacheType" to ImageCacheType.fromNativeValue(dataSource).jsValue,
            "source" to mapOf(
              "url" to (source.uri ?: ""),
              "width" to resource.intrinsicWidth,
              "height" to resource.intrinsicHeight,
              "mediaType" to null,
              "isAnimated" to (resource is com.bumptech.glide.load.resource.gif.GifDrawable)
            )
          )
        )
        return false // let Glide set it into the ImageView
      }
    }).into(mView)

    mView.post { if (generation == loadGeneration) emit("display", emptyMap()) }
  }

  /**
   * Pixel size to decode the bitmap at. `null` means "decode at natural size".
   *
   * - `allowDownscaling == false`: caller wants full resolution.
   * - local asset with an intrinsic size: already pinned by
   *   `SourceMap.toGlideOptions().override(...)`, don't fight it here.
   * - view is laid out: fit to it (Android measured px, else Lynx layout size).
   * - called before layout: cap at the screen so a large remote image is never
   *   decoded at full size on the first pass; `onLayoutUpdated` re-runs `reload`
   *   with the exact view size.
   */
  private fun resolveTargetSize(source: SourceMap): Pair<Int, Int>? {
    if (!allowDownscaling) return null
    if (source.width != 0 && source.height != 0) return null

    val viewW = if (mView.width > 0) mView.width else width
    val viewH = if (mView.height > 0) mView.height else height
    if (viewW > 0 && viewH > 0) return viewW to viewH

    val dm = mView.context.resources.displayMetrics
    return dm.widthPixels to dm.heightPixels
  }

  private fun cancel() {
    loadGeneration += 1
    runCatching { Glide.with(mView).clear(mView) }
    currentModelKey = null
  }

  private fun emit(name: String, detail: Map<String, Any?>) {
    val event = LynxCustomEvent(sign, name, detail)
    lynxContext.eventEmitter.sendCustomEvent(event)
  }

  // region parsing

  private fun parseSource(raw: String): SourceMap? {
    val trimmed = raw.trim()
    if (trimmed.isEmpty()) return null
    // The wrapper serializes an array of sources; also tolerate a bare URL
    // passed straight to the raw <x-lynx-fast-image> tag.
    return try {
      when {
        trimmed.startsWith("[") -> {
          val arr = JSONArray(trimmed)
          if (arr.length() == 0) null else sourceFromJson(arr.get(0))
        }
        trimmed.startsWith("{") -> sourceFromJson(JSONObject(trimmed))
        else -> SourceMap(uri = trimmed)
      }
    } catch (e: Exception) {
      SourceMap(uri = trimmed)
    }
  }

  private fun sourceFromJson(node: Any?): SourceMap? = when (node) {
    is String -> if (node.isBlank()) null else SourceMap(uri = node)
    is JSONObject -> SourceMap(
      uri = node.optString("uri").ifBlank { null },
      width = node.optInt("width", 0),
      height = node.optInt("height", 0),
      scale = node.optDouble("scale", 1.0),
      cacheKey = node.optString("cacheKey").ifBlank { null },
      headers = node.optJSONObject("headers")?.let { h ->
        buildMap { h.keys().forEach { put(it, h.getString(it)) } }
      }
    )
    else -> null
  }

  private fun jsonToMap(raw: String): Map<String, Any?>? = try {
    val obj = JSONObject(raw)
    buildMap { obj.keys().forEach { put(it, obj.get(it)) } }
  } catch (e: Exception) {
    null
  }

  // endregion
}
