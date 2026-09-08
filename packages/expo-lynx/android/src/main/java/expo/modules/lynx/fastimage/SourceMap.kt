package expo.modules.lynx.fastimage

import android.content.Context
import android.net.Uri
import com.bumptech.glide.load.model.GlideUrl
import com.bumptech.glide.load.model.Headers
import com.bumptech.glide.load.model.LazyHeaders
import com.bumptech.glide.request.RequestOptions
import com.bumptech.glide.signature.ObjectKey

/**
 * Ported from expo-image 57.0.4 (android .../image/records/SourceMap.kt),
 * trimmed to the schemes lynx-fast-image supports today: http(s), file, data,
 * content, and scheme-less bundled names. Blurhash / thumbhash / decoded /
 * android-resource-id model providers are deferred (PLAN §4).
 */
data class SourceMap(
  val uri: String? = null,
  val width: Int = 0,
  val height: Int = 0,
  val scale: Double = 1.0,
  val headers: Map<String, String>? = null,
  val cacheKey: String? = null
) {
  val pixelCount: Double get() = width.toDouble() * height.toDouble() * scale * scale

  private fun parsedUri(): Uri? = uri?.let { runCatching { Uri.parse(it) }.getOrNull() }

  /** The value handed to `Glide.with(view).load(model)`. */
  fun toGlideModel(context: Context): Any? {
    val raw = uri?.trim().orEmpty()
    if (raw.isEmpty()) return null

    val parsed = parsedUri()
    return when (parsed?.scheme?.lowercase()) {
      "http", "https" -> {
        val h = customHeaders()
        cacheKey?.let { GlideUrlWithCacheKey(raw, h, it) } ?: GlideUrl(raw, h)
      }
      // Glide's built-in DataUrlLoader is registered for String, not Uri.
      "data" -> raw
      "content", "file", "android.resource" -> parsed
      "res" -> Uri.parse(
        parsed.toString().replace("res:/", "android.resource://${context.packageName}/")
      )
      null -> parsed ?: raw // scheme-less: let Glide try it as a bundled name / path
      else -> parsed
    }
  }

  fun toGlideOptions(): RequestOptions = RequestOptions().apply {
    // Local assets carry an intrinsic size; pin it so `contentFit` math and
    // downscaling behave. Remote images are sized from the view instead.
    if (width != 0 && height != 0) {
      override((width * scale).toInt(), (height * scale).toInt())
    }
    cacheKey?.let { signature(ObjectKey(it)) }
  }

  private fun customHeaders(): Headers {
    if (headers.isNullOrEmpty()) return LazyHeaders.DEFAULT
    return LazyHeaders.Builder().apply {
      headers.forEach { (k, v) -> addHeader(k, v) }
    }.build()
  }
}

/** GlideUrl whose cache key is the caller-supplied string, not the full URL. */
class GlideUrlWithCacheKey(
  url: String,
  headers: Headers,
  private val customCacheKey: String
) : GlideUrl(url, headers) {
  override fun getCacheKey(): String = customCacheKey
}
