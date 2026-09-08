package com.lynxexample

import android.content.Context
import com.lynx.tasm.provider.AbsTemplateProvider
import java.io.ByteArrayOutputStream
import java.io.IOException
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * Loads a Lynx bundle from Android assets (release) or over HTTP from a rspeedy
 * dev server (a `src` starting with http:// or https://). Ported verbatim from
 * expo-lynx-view (`LynxTemplateProvider.kt`).
 */
class LynxTemplateProvider(context: Context) : AbsTemplateProvider() {
  private val appContext = context.applicationContext
  private val httpClient = OkHttpClient()

  override fun loadTemplate(uri: String, callback: Callback) {
    if (uri.startsWith("http://") || uri.startsWith("https://")) {
      loadFromNetwork(uri, callback)
    } else {
      loadFromAssets(uri, callback)
    }
  }

  private fun loadFromNetwork(uri: String, callback: Callback) {
    Thread {
      try {
        val request = Request.Builder().url(uri).build()
        httpClient.newCall(request).execute().use { response ->
          val body = response.body
          if (!response.isSuccessful || body == null) {
            callback.onFailed("HTTP ${response.code} loading $uri")
            return@use
          }
          callback.onSuccess(body.bytes())
        }
      } catch (e: IOException) {
        callback.onFailed(e.message)
      }
    }.start()
  }

  private fun loadFromAssets(uri: String, callback: Callback) {
    Thread {
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
    }.start()
  }
}
