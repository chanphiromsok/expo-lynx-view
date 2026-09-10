package expo.modules.lynx

import android.content.Context
import com.lynx.tasm.provider.AbsTemplateProvider
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * Loads a Lynx bundle either from the module's bundled Android assets (production) or over
 * HTTP(S) from a rspeedy dev server — pass a "src" starting with http:// or https:// to
 * hit a dev server for hot-iteration instead of a statically bundled asset.
 */
class LynxTemplateProvider(context: Context) : AbsTemplateProvider() {
  private val appContext = context.applicationContext
  private val httpClient = OkHttpClient()
  @Volatile private var localResourceRoot: File? = null
  @Volatile private var assetResourceRoot: String? = null

  fun setLocalResourceRoot(root: File?) {
    localResourceRoot = root
    assetResourceRoot = null
  }

  fun setAssetResourceRoot(root: String?) {
    assetResourceRoot = root?.trimEnd('/')
    localResourceRoot = null
  }

  override fun loadTemplate(uri: String, callback: Callback) {
    if (uri.startsWith("http://") || uri.startsWith("https://")) {
      loadFromNetwork(uri, callback)
    } else if (uri.startsWith("file:")) {
      // `File.toURI()` (used for managed-release bundles) yields a single-slash
      // `file:/data/...`, not `file://...`. `java.net.URI` -> `File` handles
      // both forms; the old `startsWith("file://")` check missed the common one
      // and dropped every managed release into the asset branch below.
      loadFromFile(File(java.net.URI(uri)), callback)
    } else {
      // B4 (#17): bundle-relative resource names come from template content.
      // iOS sandboxes each one in `existingFileURL` / `normalizedComponents`;
      // Android resolved `File(localResourceRoot, uri)` with no check that the
      // result stayed inside the root and no rejection of `..`. Reject a
      // traversal outright, then confirm the resolved file is still contained.
      val relative = LynxResourcePath.normalize(uri)
      if (relative == null) {
        callback.onFailed("Rejected Lynx resource path that escapes its root: $uri")
        return
      }

      localResourceRoot?.let { root ->
        val file = File(root, relative)
        if (LynxResourcePath.isContained(root, file) && file.isFile) {
          loadFromFile(file, callback)
          return
        }
      }

      val asset = assetResourceRoot?.let { root ->
        if (relative == root || relative.startsWith("$root/")) relative else "$root/$relative"
      } ?: relative
      loadFromAssets(asset, callback)
    }
  }

  // A7 (#17): dispatched via OkHttp's own async `enqueue` rather than
  // `loadExecutor` -- see that pool's companion-object comment for why.
  private fun loadFromNetwork(uri: String, callback: Callback) {
    val request = Request.Builder().url(uri).build()
    httpClient.newCall(request).enqueue(object : okhttp3.Callback {
      override fun onFailure(call: okhttp3.Call, e: IOException) {
        callback.onFailed(e.message)
      }

      override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) {
        response.use {
          val body = response.body
          if (!response.isSuccessful || body == null) {
            callback.onFailed("HTTP ${response.code} loading $uri")
            return
          }
          try {
            callback.onSuccess(body.bytes())
          } catch (e: IOException) {
            // Reading the body can itself fail (truncated stream, etc.); OkHttp
            // does not route an exception thrown from `onResponse` to
            // `onFailure`, so this has to be caught here explicitly to keep the
            // old `execute()` + outer try/catch's failure semantics.
            callback.onFailed(e.message)
          }
        }
      }
    })
  }

  private fun loadFromAssets(uri: String, callback: Callback) {
    loadExecutor.execute {
      try {
        appContext.assets.open(uri).use { input ->
          ByteArrayOutputStream().use { output ->
            val buffer = ByteArray(8192)
            var length: Int
            while (input.read(buffer).also { length = it } != -1) {
              output.write(buffer, 0, length)
            }
            callback.onSuccess(output.toByteArray())
          }
        }
      } catch (e: IOException) {
        callback.onFailed(e.message)
      }
    }
  }

  private fun loadFromFile(file: File, callback: Callback) {
    loadExecutor.execute {
      try {
        FileInputStream(file).use { input ->
          ByteArrayOutputStream().use { output ->
            input.copyTo(output)
            callback.onSuccess(output.toByteArray())
          }
        }
      } catch (e: IOException) {
        callback.onFailed(e.message)
      }
    }
  }

  private companion object {
    // B5 (#17): the provider spawned a bare `Thread` per load in all three
    // branches, so thread count scaled with in-flight resource requests. A
    // Lynx page pulling many sub-resources at once could fan out to dozens of
    // threads. This bounded pool now backs `loadFromAssets` and `loadFromFile`
    // only, shared across every provider instance in the process.
    //
    // A7 (#17): it used to also run `loadFromNetwork`'s blocking `execute()`
    // call, on the claim that this pool was the Android analogue of iOS's
    // split between `DispatchQueue.global` (local reads) and `URLSession.shared`
    // (remote fetches) -- see `ExpoLynxTemplateProvider.swift`'s `loadData`.
    // It wasn't: both branches shared this single 4-thread pool, so four
    // slow or hanging dev-server fetches could starve every local asset/file
    // load, including the main template. `loadFromNetwork` now dispatches
    // through OkHttp's own async `enqueue`, which runs on OkHttp's internal
    // dispatcher and never occupies a slot here -- that's what actually makes
    // it independent of local reads, matching iOS.
    private val loadExecutor: ExecutorService = Executors.newFixedThreadPool(4) { runnable ->
      Thread(runnable, "ExpoLynxResource").apply { isDaemon = true }
    }
  }
}
