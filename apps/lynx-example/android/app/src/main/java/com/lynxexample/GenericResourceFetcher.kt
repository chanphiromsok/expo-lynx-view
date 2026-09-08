package com.lynxexample

import com.lynx.tasm.resourceprovider.LynxResourceCallback
import com.lynx.tasm.resourceprovider.LynxResourceRequest
import com.lynx.tasm.resourceprovider.LynxResourceResponse
import com.lynx.tasm.resourceprovider.generic.LynxGenericResourceFetcher
import java.io.IOException
import okhttp3.OkHttpClient
import okhttp3.Request

// `LynxResourceResponse.onFailed` is a raw-typed Java static; cast to the
// callback's expected generic.
@Suppress("UNCHECKED_CAST")
private fun <T> failed(error: Throwable): LynxResourceResponse<T> =
  LynxResourceResponse.onFailed(error) as LynxResourceResponse<T>

/**
 * Minimal HTTP(S) generic-resource fetcher. rspeedy Fast Refresh pulls
 * `main.<hash>.hot-update.json` / `.js` through this path (Lynx routes them as
 * ExternalJS, not through the template provider).
 */
class GenericResourceFetcher : LynxGenericResourceFetcher() {
  private val client = OkHttpClient()

  override fun fetchResource(
    request: LynxResourceRequest,
    callback: LynxResourceCallback<ByteArray>,
  ) {
    Thread {
      try {
        client.newCall(Request.Builder().url(request.url).build()).execute().use { response ->
          val body = response.body
          if (!response.isSuccessful || body == null) {
            callback.onResponse(failed(IOException("HTTP ${response.code} for ${request.url}")))
          } else {
            callback.onResponse(LynxResourceResponse.onSuccess(body.bytes()))
          }
        }
      } catch (e: IOException) {
        callback.onResponse(failed(e))
      }
    }.start()
  }

  override fun fetchResourcePath(
    request: LynxResourceRequest,
    callback: LynxResourceCallback<String>,
  ) {
    callback.onResponse(failed(UnsupportedOperationException("no on-disk path for ${request.url}")))
  }
}
