package expo.modules.lynx.delivery

import android.content.Context
import android.content.pm.ApplicationInfo
import android.util.Base64
import org.json.JSONObject
import java.net.URI
import java.security.KeyFactory
import java.security.Signature
import java.security.interfaces.RSAPublicKey
import java.security.spec.X509EncodedKeySpec

internal class ManagedDeliveryException(
  val stage: String,
  val code: String,
  override val message: String,
) : Exception(message)

internal data class ManagedDeliveryConfig(
  val runtimeVersion: String,
  val endpoints: Map<String, URI>,
  private val publicKeyPEM: String,
  val allowHttp: Boolean,
) {
  val publicKey: RSAPublicKey by lazy { parsePublicKey(publicKeyPEM) }

  companion object {
    private const val assetName = "expo-lynx-delivery.json"

    fun load(context: Context): ManagedDeliveryConfig {
      val root = try {
        context.assets.open(assetName).bufferedReader().use { JSONObject(it.readText()) }
      } catch (error: Exception) {
        throw ManagedDeliveryException("manifest", "ERR_LYNX_DEPLOYMENT_CONFIGURATION", "Managed delivery is not configured in this Android build.")
      }
      val runtime = root.optString("runtimeVersion")
      val endpointsObject = root.optJSONObject("deliveryEndpoints")
      val publicKey = root.optString("publicKey")
      if (root.optInt("schemaVersion") != 1 || runtime.isBlank() || runtime.toByteArray().size > 128 || endpointsObject == null || publicKey.isBlank()) {
        throw ManagedDeliveryException("manifest", "ERR_LYNX_DEPLOYMENT_CONFIGURATION", "Managed delivery configuration is invalid.")
      }
      val allowHttp = context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
      val endpoints = buildMap {
        val keys = endpointsObject.keys()
        while (keys.hasNext()) {
          val feature = keys.next()
          val value = endpointsObject.optString(feature)
          if (!feature.matches(Regex("[a-z][a-z0-9-]{0,63}"))) continue
          val uri = try { URI(value) } catch (_: Exception) { continue }
          if ((uri.scheme != "https" && uri.scheme != "http") || uri.host.isNullOrBlank() || uri.userInfo != null || uri.query != null || uri.fragment != null) continue
          if (uri.scheme == "http" && !allowHttp) continue
          put(feature, uri)
        }
      }
      if (endpoints.isEmpty()) throw ManagedDeliveryException("manifest", "ERR_LYNX_DEPLOYMENT_CONFIGURATION", "Managed delivery has no valid feature endpoints.")
      return ManagedDeliveryConfig(runtime, endpoints, publicKey, allowHttp)
    }

    private fun parsePublicKey(pem: String): RSAPublicKey {
      val body = pem.trim()
        .removePrefix("-----BEGIN PUBLIC KEY-----")
        .removeSuffix("-----END PUBLIC KEY-----")
        .filterNot(Char::isWhitespace)
      val bytes = try { Base64.decode(body, Base64.DEFAULT) } catch (_: IllegalArgumentException) {
        throw ManagedDeliveryException("signature", "ERR_LYNX_PUBLIC_KEY", "The embedded Lynx public key is invalid.")
      }
      val key = try {
        KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(bytes)) as? RSAPublicKey
      } catch (_: Exception) {
        null
      }
      if (key == null || key.modulus.bitLength() < 3072 || key.publicExponent.toInt() != 65537) {
        throw ManagedDeliveryException("signature", "ERR_LYNX_PUBLIC_KEY", "The embedded Lynx public key is invalid.")
      }
      return key
    }
  }
}

internal data class Deployment(
  val enabled: Boolean,
  val revision: Int,
  val releaseId: String? = null,
  val version: String? = null,
  val archiveUrl: String? = null,
  val archiveSha256: String? = null,
  val archiveBytes: Long? = null,
  val force: Boolean? = null,
)

internal fun decodeSignedDeployment(
  bytes: ByteArray,
  signature: String?,
  config: ManagedDeliveryConfig,
  feature: String,
): Deployment {
  if (signature.isNullOrBlank()) throw ManagedDeliveryException("signature", "ERR_LYNX_SIGNATURE_MISSING", "The Lynx deployment response has no signature.")
  val signatureBytes = try { Base64.decode(signature, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP) } catch (_: IllegalArgumentException) {
    throw ManagedDeliveryException("signature", "ERR_LYNX_SIGNATURE_BASE64", "The Lynx deployment signature is invalid.")
  }
  val verified = try {
    Signature.getInstance("SHA256withRSA").run {
      initVerify(config.publicKey)
      update(bytes)
      verify(signatureBytes)
    }
  } catch (_: Exception) { false }
  if (!verified) throw ManagedDeliveryException("signature", "ERR_LYNX_SIGNATURE_INVALID", "The Lynx deployment signature is invalid.")

  val payload = try { JSONObject(String(bytes, Charsets.UTF_8)) } catch (_: Exception) {
    throw ManagedDeliveryException("manifest", "ERR_LYNX_DEPLOYMENT_INVALID", "The signed deployment payload is invalid JSON.")
  }
  val enabled = payload.opt("enabled") as? Boolean
  val runtime = payload.optString("runtimeVersion")
  val revision = payload.optInt("revision", 0)
  if (payload.optInt("schemaVersion") != 1 || payload.optString("type") != "lynx-deployment" || payload.optString("feature") != feature || enabled == null || revision <= 0 || runtime != config.runtimeVersion) {
    throw ManagedDeliveryException("compatibility", "ERR_LYNX_RUNTIME_INCOMPATIBLE", "The signed deployment targets another runtime version.")
  }
  if (!enabled) return Deployment(enabled = false, revision = revision)
  val releaseId = payload.optString("releaseId")
  val version = payload.optString("version")
  val archiveUrl = payload.optString("archiveUrl")
  val archiveSha256 = payload.optString("archiveSha256")
  val archiveBytes = payload.optLong("archiveBytes", -1)
  val force = payload.opt("force") as? Boolean
  if (!releaseId.matches(Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,127}")) || version.isBlank() || archiveUrl.isBlank() || !archiveSha256.matches(Regex("[a-f0-9]{64}")) || archiveBytes !in 1..ManagedBundleStore.maxArchiveBytes || force == null) {
    throw ManagedDeliveryException("manifest", "ERR_LYNX_DEPLOYMENT_INVALID", "The signed deployment payload is missing a valid release.")
  }
  return Deployment(true, revision, releaseId, version, archiveUrl, archiveSha256, archiveBytes, force)
}
