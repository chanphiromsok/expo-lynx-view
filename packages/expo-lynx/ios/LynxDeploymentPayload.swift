import Foundation

struct LynxDeploymentPayload: Decodable, Sendable {
  let type: String
  let feature: String
  let revision: Int
  let enabled: Bool
  let releaseId: String?
  let manifestUrl: String?
  let manifestSha256: String?
  let force: Bool?
  let issuedAt: String

  static func decodeVerified(
    _ data: Data,
    expectedFeature: String
  ) throws -> LynxDeploymentPayload {
    let object: [String: Any]
    let payload: LynxDeploymentPayload
    do {
      guard let decoded = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw invalid("The signed deployment payload is not an object.")
      }
      object = decoded
      payload = try JSONDecoder().decode(Self.self, from: data)
    } catch let error as LynxDeliveryError {
      throw error
    } catch {
      throw invalid("The signed deployment payload is invalid JSON.")
    }

    let commonKeys: Set<String> = ["type", "feature", "revision", "enabled", "issuedAt"]
    let enabledKeys = commonKeys.union(["releaseId", "manifestUrl", "manifestSha256", "force"])
    guard Set(object.keys).isSubset(of: payload.enabled ? enabledKeys : commonKeys) else {
      throw invalid("The signed deployment payload contains unsupported fields.")
    }

    guard payload.type == "lynx-deployment",
      payload.feature == expectedFeature,
      expectedFeature.range(of: "^[a-z][a-z0-9-]{0,63}$", options: .regularExpression) != nil,
      payload.revision > 0,
      parseTimestamp(payload.issuedAt) != nil
    else {
      throw invalid("The signed deployment payload violates the V2 protocol.")
    }

    if payload.enabled {
      guard let releaseId = payload.releaseId,
        releaseId.range(of: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$", options: .regularExpression) != nil,
        let manifestUrl = payload.manifestUrl,
        isSafeArtifactURL(manifestUrl),
        let manifestSha256 = payload.manifestSha256,
        manifestSha256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
        payload.force != nil
      else {
        throw invalid("An enabled deployment is missing a valid release selection.")
      }
    } else if payload.releaseId != nil || payload.manifestUrl != nil
      || payload.manifestSha256 != nil || payload.force != nil
    {
      throw invalid("A disabled deployment cannot select a release.")
    }
    return payload
  }

  private static func isSafeArtifactURL(_ value: String) -> Bool {
    guard let url = URL(string: value), !value.isEmpty, value.count <= 2048,
      !value.contains("\\"), !value.contains("\0")
    else { return false }
    if let scheme = url.scheme?.lowercased() {
      return ["http", "https"].contains(scheme) && url.host != nil
        && url.user == nil && url.password == nil && url.fragment == nil
    }
    guard !value.hasPrefix("/"), url.query == nil, url.fragment == nil else { return false }
    return value.split(separator: "/", omittingEmptySubsequences: false).allSatisfy {
      !$0.isEmpty && $0 != "." && $0 != ".."
    }
  }

  private static func parseTimestamp(_ value: String) -> Date? {
    let standard = ISO8601DateFormatter()
    if let date = standard.date(from: value) { return date }
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions.insert(.withFractionalSeconds)
    return fractional.date(from: value)
  }

  private static func invalid(_ message: String) -> LynxDeliveryError {
    LynxDeliveryError(
      stage: .manifest,
      code: "ERR_LYNX_DEPLOYMENT_INVALID",
      message: message
    )
  }
}
