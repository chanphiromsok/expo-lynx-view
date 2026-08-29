import Foundation

enum LynxManagedDeliveryConfiguration {
  private static let infoPlistDeliveryChannels = "ExpoLynxDeliveryChannels"

  static func channelURL(feature: String, channel: String) throws -> URL {
    guard let channels = Bundle.main.object(forInfoDictionaryKey: infoPlistDeliveryChannels) as? [String: Any],
      let featureChannels = channels[feature] as? [String: Any],
      let value = featureChannels[channel] as? String,
      let url = URL(string: value),
      ["http", "https"].contains(url.scheme?.lowercased()),
      url.user == nil,
      url.password == nil,
      url.query == nil,
      url.fragment == nil
    else {
      throw LynxDeliveryError(
        stage: .manifest,
        code: "ERR_LYNX_CHANNEL_CONFIGURATION",
        message: "No build-time Lynx delivery channel is configured for \(feature)/\(channel)."
      )
    }
    #if !DEBUG && !LYNX_ALLOW_LOCAL_MANAGED_RELEASE
      if url.scheme?.lowercased() == "http" {
        throw LynxDeliveryError(
          stage: .manifest,
          code: "ERR_LYNX_LOCAL_HTTP_FORBIDDEN",
          message: "Cleartext managed delivery is allowed only in an internal Release build."
        )
      }
    #endif
    return url
  }
}

struct LynxManagedUpdateCheckResult: Sendable {
  enum Status: String, Sendable {
    case noUpdate = "no-update"
    case downloaded
    case pending
  }

  let feature: String
  let channel: String
  let status: Status
  let releaseID: String?
  let version: String?
  let revision: Int?

  func eventPayload(phase: String) -> [String: Any] {
    var payload: [String: Any] = ["feature": feature, "channel": channel, "phase": phase]
    if let releaseID { payload["releaseId"] = releaseID }
    if let version { payload["version"] = version }
    if let revision { payload["revision"] = revision }
    return payload
  }

  func modulePayload() -> [String: Any] {
    var payload: [String: Any] = ["feature": feature, "channel": channel, "status": status.rawValue]
    if let releaseID { payload["releaseId"] = releaseID }
    if let version { payload["version"] = version }
    return payload
  }
}

/// Serializes the channel-state portion of managed delivery independently from
/// any particular LynxView. A module request and a mounted view both join the
/// store's feature/channel deduplication rather than creating a second update
/// path with independently supplied URLs.
actor LynxManagedDeliveryCoordinator {
  static let shared = LynxManagedDeliveryCoordinator()

  func checkForUpdate(feature: String, channel: String) async throws -> LynxManagedUpdateCheckResult {
    let channelURL = try LynxManagedDeliveryConfiguration.channelURL(feature: feature, channel: channel)
    return try await checkForUpdate(feature: feature, channel: channel, channelURL: channelURL)
  }

  func checkForUpdate(
    feature: String,
    channel: String,
    channelURL: URL
  ) async throws -> LynxManagedUpdateCheckResult {
    let state = await LynxManagedChannelState.shared.recover(feature: feature, channel: channel)
    var knownReleaseIDs = state.failedManifestIDs
    [state.activeManifestID, state.pendingManifestID, state.attemptingManifestID,
     state.previousManifestID].compactMap { $0 }.forEach { knownReleaseIDs.append($0) }

    let result = try await LynxManagedBundleStore.shared.checkForUpdate(
      channelEnvelopeURL: channelURL,
      expectedFeature: feature,
      expectedChannel: channel,
      eTag: state.lastETag,
      knownReleaseIDs: Set(knownReleaseIDs)
    )
    switch result {
    case let .noUpdate(eTag, revision):
      await LynxManagedChannelState.shared.recordChannelCheck(
        eTag: eTag, revision: revision, feature: feature, channel: channel
      )
      return LynxManagedUpdateCheckResult(
        feature: feature, channel: channel, status: .noUpdate, releaseID: nil, version: nil, revision: revision
      )
    case let .downloaded(release, eTag, revision):
      await LynxManagedChannelState.shared.recordChannelCheck(
        eTag: eTag, revision: revision, feature: feature, channel: channel
      )
      guard !state.failedManifestIDs.contains(release.manifestID),
        state.activeManifestID != release.manifestID,
        state.pendingManifestID != release.manifestID
      else {
        return LynxManagedUpdateCheckResult(
          feature: feature, channel: channel, status: .noUpdate,
          releaseID: release.manifestID, version: release.version, revision: revision
        )
      }
      await LynxManagedChannelState.shared.stage(
        manifestID: release.manifestID, feature: feature, channel: channel
      )
      return LynxManagedUpdateCheckResult(
        feature: feature, channel: channel, status: .pending,
        releaseID: release.manifestID, version: release.version, revision: revision
      )
    }
  }
}
