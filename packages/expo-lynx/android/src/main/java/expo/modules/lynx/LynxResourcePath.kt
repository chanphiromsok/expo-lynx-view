package expo.modules.lynx

import java.io.File
import java.net.URLDecoder

/**
 * Path-safety helpers for bundle-relative Lynx resource names.
 *
 * B4 (#17): resource names arrive from template content, so `..` traversal and
 * absolute/scheme paths must be rejected before they reach the filesystem.
 * iOS enforces this in `ExpoLynxTemplateProvider.normalizedComponents` /
 * `existingFileURL`; this is the Android equivalent. Kept Android-free so it is
 * unit-testable without a device.
 */
internal object LynxResourcePath {
  private val SCHEME = Regex("^[a-zA-Z][a-zA-Z0-9+.\\-]*://")

  /**
   * Strip a `bundle://` prefix, reject any other explicit scheme, percent-decode
   * (without turning `+` into a space, matching iOS `removingPercentEncoding`),
   * trim slashes, and reject `.` / `..` segments. Returns a clean relative path,
   * or `null` if the input is not a safe bundle-relative reference.
   */
  fun normalize(value: String): String? {
    var path = value
    if (path.startsWith("bundle://")) {
      path = path.removePrefix("bundle://")
    } else if (SCHEME.containsMatchIn(path)) {
      return null
    }

    path = runCatching { URLDecoder.decode(path.replace("+", "%2B"), "UTF-8") }
      .getOrDefault(path)
      .trim('/')

    val components = path.split('/').filter { it.isNotEmpty() }
    if (components.isEmpty() || components.any { it == "." || it == ".." }) return null
    return components.joinToString("/")
  }

  /** True when [candidate] resolves to [root] itself or a path beneath it. */
  fun isContained(root: File, candidate: File): Boolean {
    val rootPath = runCatching { root.canonicalFile.path }.getOrNull() ?: return false
    val candidatePath = runCatching { candidate.canonicalFile.path }.getOrNull() ?: return false
    return candidatePath == rootPath || candidatePath.startsWith(rootPath + File.separator)
  }
}
