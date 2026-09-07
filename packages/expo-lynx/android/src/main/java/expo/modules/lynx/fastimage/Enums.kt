package expo.modules.lynx.fastimage

import com.bumptech.glide.Priority as GlidePriority
import com.bumptech.glide.load.DataSource
import com.bumptech.glide.load.DecodeFormat as GlideDecodeFormat
import com.bumptech.glide.load.engine.DiskCacheStrategy

/**
 * Ported from expo-image 57.0.4 (android .../image/enums + records). The
 * `Enumerable` supertype is replaced by a `from(String?)` parser on each.
 */

enum class ImagePriority(val value: String) {
  LOW("low"),
  NORMAL("normal"),
  HIGH("high");

  fun toGlidePriority(): GlidePriority = when (this) {
    LOW -> GlidePriority.LOW
    NORMAL -> GlidePriority.NORMAL
    HIGH -> GlidePriority.IMMEDIATE
  }

  companion object {
    fun from(value: String?): ImagePriority = entries.firstOrNull { it.value == value } ?: NORMAL
  }
}

enum class ImageCachePolicy(val value: String) {
  NONE("none"),
  DISK("disk"),
  MEMORY("memory"),
  MEMORY_AND_DISK("memory-disk");

  fun skipMemoryCache(): Boolean = this == NONE || this == DISK

  fun toDiskCacheStrategy(): DiskCacheStrategy = when (this) {
    NONE -> DiskCacheStrategy.NONE
    MEMORY -> DiskCacheStrategy.NONE
    DISK, MEMORY_AND_DISK -> DiskCacheStrategy.AUTOMATIC
  }

  companion object {
    fun from(value: String?): ImageCachePolicy = entries.firstOrNull { it.value == value } ?: MEMORY_AND_DISK
  }
}

/** Reported back in the `load` event payload. */
enum class ImageCacheType(private vararg val dataSources: DataSource) {
  NONE(DataSource.LOCAL, DataSource.REMOTE),
  DISK(DataSource.DATA_DISK_CACHE, DataSource.RESOURCE_DISK_CACHE),
  MEMORY(DataSource.MEMORY_CACHE);

  val jsValue: String
    get() = when (this) {
      NONE -> "none"
      DISK -> "disk"
      MEMORY -> "memory"
    }

  companion object {
    fun fromNativeValue(value: DataSource?): ImageCacheType =
      entries.firstOrNull { it.dataSources.contains(value) } ?: NONE
  }
}

enum class ImageDecodeFormat(val value: String) {
  ARGB_8888("argb"),
  RGB_565("rgb");

  fun toGlideFormat(): GlideDecodeFormat = when (this) {
    ARGB_8888 -> GlideDecodeFormat.PREFER_ARGB_8888
    RGB_565 -> GlideDecodeFormat.PREFER_RGB_565
  }

  companion object {
    fun from(value: String?): ImageDecodeFormat? = entries.firstOrNull { it.value == value }
  }
}
