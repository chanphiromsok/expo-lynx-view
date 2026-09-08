package expo.modules.lynx.delivery

import android.content.Context
import okhttp3.CacheControl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.URI
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.zip.ZipFile

internal data class ManagedRelease(
  val feature: String,
  val releaseId: String,
  val version: String,
  val bundle: File,
)

internal sealed class DeploymentUpdate {
  data class NotModified(val eTag: String?) : DeploymentUpdate()
  data class Disabled(val eTag: String?, val revision: Int) : DeploymentUpdate()
  data class Selected(val release: ManagedRelease, val force: Boolean, val eTag: String?, val revision: Int) : DeploymentUpdate()
}

internal class ManagedBundleStore(private val context: Context) {
  companion object {
    const val maxArchiveBytes = 64L * 1024L * 1024L
    private const val maxUncompressedBytes = 256L * 1024L * 1024L
    private const val maxSingleEntryBytes = 64L * 1024L * 1024L
    private const val maxEntries = 4096
  }

  private val root = File(context.filesDir, "expo-lynx/managed")
  // The first render only reads a completion marker. Do not initialize OkHttp
  // until the post-render delivery check actually needs it.
  private val client by lazy { OkHttpClient.Builder()
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(60, TimeUnit.SECONDS)
    .build() }

  fun launchInstalledRelease(feature: String, releaseId: String, runtime: String): ManagedRelease? {
    if (!isSafeFeature(feature) || !isSafeReleaseId(releaseId)) return null
    return completedRelease(readyDirectory(feature, runtime, releaseId), feature, releaseId, runtime)
  }

  fun checkForUpdate(
    config: ManagedDeliveryConfig,
    feature: String,
    state: ManagedState,
  ): DeploymentUpdate {
    val endpoint = config.endpoints[feature]
      ?: throw ManagedDeliveryException("manifest", "ERR_LYNX_DEPLOYMENT_CONFIGURATION", "No build-time Lynx deployment endpoint is configured for $feature.")
    val request = Request.Builder().url(endpoint.toString())
      .cacheControl(CacheControl.FORCE_NETWORK)
      .header("lynx-runtime-version", config.runtimeVersion)
      .header("lynx-platform", "android")
      .apply { state.lastETag?.takeIf(String::isNotBlank)?.let { header("If-None-Match", it) } }
      .build()
    client.newCall(request).execute().use { response ->
      val responseETag = response.header("ETag") ?: state.lastETag
      if (response.code == 304) return DeploymentUpdate.NotModified(responseETag)
      if (!response.isSuccessful) throw ManagedDeliveryException("download", "ERR_LYNX_HTTP_${response.code}", "The Lynx deployment request failed (HTTP ${response.code}).")
      val body = response.body ?: throw ManagedDeliveryException("download", "ERR_LYNX_HTTP_0", "The Lynx deployment response has no body.")
      if (body.contentLength() > 16 * 1024) throw ManagedDeliveryException("signature", "ERR_LYNX_DEPLOYMENT_TOO_LARGE", "The signed Lynx deployment response exceeds 16 KiB.")
      val bytes = body.bytes()
      if (bytes.size > 16 * 1024) throw ManagedDeliveryException("signature", "ERR_LYNX_DEPLOYMENT_TOO_LARGE", "The signed Lynx deployment response exceeds 16 KiB.")
      val deployment = decodeSignedDeployment(bytes, response.header("lynx-signature"), config, feature)
      state.lastRevision?.let { previous ->
        if (deployment.revision < previous) throw ManagedDeliveryException("manifest", "ERR_LYNX_DEPLOYMENT_REPLAY", "The signed deployment revision is older than local state.")
        if (deployment.revision == previous) {
          if (responseETag != state.lastETag) throw ManagedDeliveryException("manifest", "ERR_LYNX_DEPLOYMENT_CONFLICT", "The signed deployment changed without a newer revision.")
          return DeploymentUpdate.NotModified(responseETag)
        }
      }
      if (!deployment.enabled) return DeploymentUpdate.Disabled(responseETag, deployment.revision)
      val releaseId = deployment.releaseId!!
      if (releaseId in state.failedReleaseIds) return DeploymentUpdate.NotModified(responseETag)
      val installed = launchInstalledRelease(feature, releaseId, config.runtimeVersion)
      val release = installed ?: install(
        config = config,
        feature = feature,
        releaseId = releaseId,
        version = deployment.version!!,
        archiveUrl = resolveArchiveURL(endpoint, deployment.archiveUrl!!, config.allowHttp),
        archiveBytes = deployment.archiveBytes!!,
        archiveHash = deployment.archiveSha256!!,
      )
      return DeploymentUpdate.Selected(release, deployment.force!!, responseETag, deployment.revision)
    }
  }

  private fun install(
    config: ManagedDeliveryConfig,
    feature: String,
    releaseId: String,
    version: String,
    archiveUrl: URI,
    archiveBytes: Long,
    archiveHash: String,
  ): ManagedRelease {
    launchInstalledRelease(feature, releaseId, config.runtimeVersion)?.let { return it }
    val staging = File(featureRoot(feature), "staging/${UUID.randomUUID()}")
    val archive = File(staging, "release.zip.part")
    val extracted = File(staging, "release")
    try {
      if (!staging.mkdirs()) throw ManagedDeliveryException("resource", "ERR_LYNX_ARCHIVE_CREATE", "The Lynx release transaction directory could not be created.")
      downloadArchive(archiveUrl, archive, archiveBytes, archiveHash)
      extractArchive(archive, extracted)
      File(extracted, "completion.json").writeText(JSONObject().apply {
        put("feature", feature)
        put("releaseId", releaseId)
        put("version", version)
        put("runtimeVersion", config.runtimeVersion)
        put("archiveSha256", archiveHash)
      }.toString())
      val final = readyDirectory(feature, config.runtimeVersion, releaseId)
      final.parentFile?.mkdirs()
      if (!final.exists() && !extracted.renameTo(final)) {
        throw ManagedDeliveryException("archive", "ERR_LYNX_RELEASE_INSTALL", "The completed Lynx release could not be installed.")
      }
      return completedRelease(final, feature, releaseId, config.runtimeVersion)
        ?: throw ManagedDeliveryException("archive", "ERR_LYNX_RELEASE_INSTALL", "The completed Lynx release could not be reopened.")
    } finally {
      staging.deleteRecursively()
    }
  }

  private fun downloadArchive(url: URI, destination: File, expectedBytes: Long, expectedHash: String) {
    val request = Request.Builder().url(url.toString()).cacheControl(CacheControl.FORCE_NETWORK).build()
    client.newCall(request).execute().use { response ->
      if (!response.isSuccessful) throw ManagedDeliveryException("download", "ERR_LYNX_HTTP_${response.code}", "The Lynx release request failed (HTTP ${response.code}).")
      val body = response.body ?: throw ManagedDeliveryException("download", "ERR_LYNX_HTTP_0", "The Lynx release response has no body.")
      if (body.contentLength() >= 0 && body.contentLength() != expectedBytes) throw ManagedDeliveryException("checksum", "ERR_LYNX_SIZE_MISMATCH", "The release ZIP Content-Length does not match the signed deployment.")
      val digest = MessageDigest.getInstance("SHA-256")
      var written = 0L
      body.byteStream().use { input ->
        FileOutputStream(destination).use { output ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            written += count
            if (written > expectedBytes) throw ManagedDeliveryException("checksum", "ERR_LYNX_SIZE_MISMATCH", "The release ZIP exceeds the signed byte length.")
            digest.update(buffer, 0, count)
            output.write(buffer, 0, count)
          }
        }
      }
      if (written != expectedBytes || digest.digest().toHex() != expectedHash) throw ManagedDeliveryException("checksum", "ERR_LYNX_SHA256_MISMATCH", "The release ZIP does not match the signed deployment.")
    }
  }

  private fun extractArchive(archive: File, destination: File) {
    var total = 0L
    var mainBundles = 0
    val names = hashSetOf<String>()
    ZipFile(archive).use { zip ->
      val entries = zip.entries()
      var count = 0
      while (entries.hasMoreElements()) {
        val entry = entries.nextElement()
        count += 1
        if (count > maxEntries || entry.isDirectory || !isSafeArchivePath(entry.name) || !names.add(entry.name.lowercase()) || entry.size !in 1..maxSingleEntryBytes || entry.compressedSize <= 0 || entry.size > entry.compressedSize * 100) {
          throw ManagedDeliveryException("archive", "ERR_LYNX_ARCHIVE_INVALID", "The release ZIP contains an unsafe entry.")
        }
        total += entry.size
        if (total > maxUncompressedBytes) throw ManagedDeliveryException("archive", "ERR_LYNX_ARCHIVE_INVALID", "The release ZIP exceeds extraction limits.")
        if (entry.name == "main.lynx.bundle") mainBundles += 1
        val target = File(destination, entry.name)
        if (!target.canonicalPath.startsWith(destination.canonicalPath + File.separator)) throw ManagedDeliveryException("archive", "ERR_LYNX_ARCHIVE_INVALID", "The release ZIP entry escapes its destination.")
        target.parentFile?.mkdirs()
        zip.getInputStream(entry).use { input ->
          FileOutputStream(target).use { output -> input.copyTo(output) }
        }
      }
    }
    if (mainBundles != 1) throw ManagedDeliveryException("archive", "ERR_LYNX_ARCHIVE_INVALID", "The release ZIP must contain one main.lynx.bundle.")
  }

  private fun completedRelease(directory: File, feature: String, releaseId: String, runtime: String): ManagedRelease? {
    val bundle = File(directory, "main.lynx.bundle")
    val completion = try { JSONObject(File(directory, "completion.json").readText()) } catch (_: Exception) { return null }
    if (!bundle.isFile || completion.optString("feature") != feature || completion.optString("releaseId") != releaseId || completion.optString("runtimeVersion") != runtime) return null
    return ManagedRelease(feature, releaseId, completion.optString("version"), bundle)
  }

  private fun featureRoot(feature: String) = File(root, feature)
  private fun readyDirectory(feature: String, runtime: String, releaseId: String) = File(featureRoot(feature), "ready/${runtime.sha256()}/$releaseId")

  private fun resolveArchiveURL(deployment: URI, value: String, allowHttp: Boolean): URI {
    val resolved = try { deployment.resolve(URI(value)) } catch (_: Exception) { throw ManagedDeliveryException("manifest", "ERR_LYNX_FILE_URL", "The Lynx release URL is invalid.") }
    if ((resolved.scheme != "https" && (resolved.scheme != "http" || !allowHttp)) || resolved.host.isNullOrBlank() || resolved.userInfo != null || resolved.query != null || resolved.fragment != null) throw ManagedDeliveryException("manifest", "ERR_LYNX_FILE_URL", "The Lynx release URL is invalid.")
    return resolved
  }

  private fun isSafeFeature(value: String) = value.matches(Regex("[a-z][a-z0-9-]{0,63}"))
  private fun isSafeReleaseId(value: String) = value.matches(Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,127}"))
  private fun isSafeArchivePath(value: String): Boolean = value.isNotBlank() && value.length <= 512 && !value.startsWith("/") && !value.contains('\\') && value.split('/').all { it.isNotBlank() && it != "." && it != ".." }
}

private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }
private fun String.sha256(): String = MessageDigest.getInstance("SHA-256").digest(toByteArray()).toHex()
