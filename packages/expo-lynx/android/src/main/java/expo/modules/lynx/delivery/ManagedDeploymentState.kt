package expo.modules.lynx.delivery

import android.content.Context
import com.tencent.mmkv.MMKV
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

internal data class ManagedState(
  var activeReleaseId: String? = null,
  var previousReleaseId: String? = null,
  var pendingReleaseId: String? = null,
  var attemptingReleaseId: String? = null,
  var failedReleaseIds: MutableSet<String> = linkedSetOf(),
  var lastETag: String? = null,
  var lastRevision: Int? = null,
)

internal class ManagedDeploymentState(context: Context) {
  companion object {
    private const val storeId = "expo.lynx.managed.v3"
    private val lock = Any()
    private val recoveredScopes = mutableSetOf<String>()

    private var didInitializeMMKV = false

    private fun openStore(context: Context): MMKV? = synchronized(lock) {
      try {
        if (!didInitializeMMKV) {
          MMKV.initialize(context.applicationContext)
          didInitializeMMKV = true
        }
        MMKV.mmkvWithID(storeId, MMKV.SINGLE_PROCESS_MODE)
      } catch (_: Exception) {
        null
      }
    }
  }

  private val store = openStore(context)
  private val legacyPreferences = context.getSharedPreferences(storeId, Context.MODE_PRIVATE)

  fun recover(feature: String, runtime: String): ManagedState = synchronized(lock) {
    val key = key(feature, runtime)
    val state = read(key)
    if (!recoveredScopes.add(key)) return@synchronized state
    state.attemptingReleaseId?.let {
      state.failedReleaseIds.add(it)
      state.attemptingReleaseId = null
      write(key, state)
    }
    state
  }

  fun recordDeployment(feature: String, runtime: String, eTag: String?, revision: Int) = mutate(feature, runtime) {
    if (!eTag.isNullOrBlank()) lastETag = eTag
    lastRevision = revision
  }

  fun stage(feature: String, runtime: String, releaseId: String) = mutate(feature, runtime) {
    if (activeReleaseId != releaseId && releaseId !in failedReleaseIds) pendingReleaseId = releaseId
  }

  fun beginAttempt(feature: String, runtime: String, releaseId: String) = mutate(feature, runtime) {
    previousReleaseId = activeReleaseId
    pendingReleaseId = null
    attemptingReleaseId = releaseId
  }

  fun confirm(feature: String, runtime: String, releaseId: String) = mutate(feature, runtime) {
    if (attemptingReleaseId == releaseId) {
      activeReleaseId = releaseId
      attemptingReleaseId = null
      pendingReleaseId = null
    }
  }

  fun fail(feature: String, runtime: String, releaseId: String) = mutate(feature, runtime) {
    failedReleaseIds.add(releaseId)
    if (activeReleaseId == releaseId) {
      activeReleaseId = previousReleaseId
      previousReleaseId = null
    }
    if (attemptingReleaseId == releaseId) attemptingReleaseId = null
    if (pendingReleaseId == releaseId) pendingReleaseId = null
  }

  private fun mutate(feature: String, runtime: String, block: ManagedState.() -> Unit) = synchronized(lock) {
    val key = key(feature, runtime)
    read(key).apply(block).also { write(key, it) }
  }

  private fun read(key: String): ManagedState {
    val value = store?.decodeString(key, null) ?: legacyPreferences.getString(key, null)?.also { legacy ->
      if (store?.encode(key, legacy) == true) {
        legacyPreferences.edit().remove(key).commit()
      }
    } ?: return ManagedState()
    return try {
      JSONObject(value).let {
        ManagedState(
          activeReleaseId = it.optString("activeReleaseId").takeIf(String::isNotBlank),
          previousReleaseId = it.optString("previousReleaseId").takeIf(String::isNotBlank),
          pendingReleaseId = it.optString("pendingReleaseId").takeIf(String::isNotBlank),
          attemptingReleaseId = it.optString("attemptingReleaseId").takeIf(String::isNotBlank),
          failedReleaseIds = buildSet {
            val values = it.optJSONArray("failedReleaseIds") ?: JSONArray()
            for (index in 0 until values.length()) values.optString(index).takeIf(String::isNotBlank)?.let(::add)
          }.toMutableSet(),
          lastETag = it.optString("lastETag").takeIf(String::isNotBlank),
          lastRevision = it.optInt("lastRevision", 0).takeIf { revision -> revision > 0 },
        )
      }
    } catch (_: Exception) { ManagedState() }
  }

  private fun write(key: String, state: ManagedState) {
    val value = JSONObject().apply {
      state.activeReleaseId?.let { put("activeReleaseId", it) }
      state.previousReleaseId?.let { put("previousReleaseId", it) }
      state.pendingReleaseId?.let { put("pendingReleaseId", it) }
      state.attemptingReleaseId?.let { put("attemptingReleaseId", it) }
      put("failedReleaseIds", JSONArray(state.failedReleaseIds.toList()))
      state.lastETag?.let { put("lastETag", it) }
      state.lastRevision?.let { put("lastRevision", it) }
    }.toString()
    if (store?.encode(key, value) != true) {
      legacyPreferences.edit().putString(key, value).commit()
    }
  }

  private fun key(feature: String, runtime: String): String = "expo.lynx.managed.v3.${sha256(runtime)}.$feature"

  private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
    .digest(value.toByteArray())
    .joinToString("") { "%02x".format(it) }
}
