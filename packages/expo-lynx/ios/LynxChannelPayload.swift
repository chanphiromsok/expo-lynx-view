import Foundation

/// The signed channel pointer is deliberately small. It authorizes the next
/// immutable release envelope; it never contains executable bytes itself.
struct LynxChannelPayload: Decodable, Sendable {
  let type: String
  let feature: String
  let channel: String
  let revision: Int
  let releaseId: String
  let manifestUrl: String
  let manifestSha256: String
  let runtimeVersion: String
  let activation: String
  let force: Bool
  let issuedAt: String
  let expiresAt: String?

  static func decodeVerified(
    _ data: Data,
    expectedFeature: String,
    expectedChannel: String
  ) throws -> LynxChannelPayload {
    let payload: LynxChannelPayload
    do {
      payload = try JSONDecoder().decode(Self.self, from: data)
    } catch {
      throw invalid("The signed channel payload is invalid JSON.")
    }

    let feature = try! NSRegularExpression(pattern: "^[a-z][a-z0-9-]{0,63}$")
    let channel = try! NSRegularExpression(pattern: "^[a-z][a-z0-9-]{0,31}$")
    let releaseID = try! NSRegularExpression(pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
    let runtime = try! NSRegularExpression(pattern: "^[A-Za-z0-9][A-Za-z0-9._+.-]{0,127}$")
    func matches(_ expression: NSRegularExpression, _ value: String) -> Bool {
      expression.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) != nil
    }

    guard payload.type == "lynx-channel",
      payload.feature == expectedFeature,
      payload.channel == expectedChannel,
      matches(feature, expectedFeature),
      matches(channel, expectedChannel),
      payload.revision > 0,
      matches(releaseID, payload.releaseId),
      matches(runtime, payload.runtimeVersion),
      payload.activation == "next-open" || payload.activation == "on-launch",
      payload.manifestSha256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
      isSafeArtifactURL(payload.manifestUrl),
      parseTimestamp(payload.issuedAt) != nil
    else {
      throw invalid("The signed channel payload violates the V2 protocol.")
    }
    if let expiresAt = payload.expiresAt {
      guard let issuedAt = parseTimestamp(payload.issuedAt),
        let expiration = parseTimestamp(expiresAt),
        expiration >= issuedAt
      else { throw invalid("The signed channel payload has invalid expiry timestamps.") }
    }
    return payload
  }

  private static func isSafeArtifactURL(_ value: String) -> Bool {
    guard let url = URL(string: value), !value.isEmpty else { return false }
    return url.scheme == nil || url.scheme?.lowercased() == "http" || url.scheme?.lowercased() == "https"
  }

  private static func parseTimestamp(_ value: String) -> Date? {
    let standard = ISO8601DateFormatter()
    if let date = standard.date(from: value) { return date }
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions.insert(.withFractionalSeconds)
    return fractional.date(from: value)
  }

  private static func invalid(_ message: String) -> LynxDeliveryError {
    LynxDeliveryError(stage: .manifest, code: "ERR_LYNX_CHANNEL_INVALID", message: message)
  }
}
