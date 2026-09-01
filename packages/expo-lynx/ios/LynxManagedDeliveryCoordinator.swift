import Foundation

enum LynxManagedDeliveryConfiguration {
  private static let infoPlistDeliveryEndpoints = "ExpoLynxDeliveryEndpoints"
  private static let infoPlistRuntimeVersion = "EXUpdatesRuntimeVersion"
  private static let legacyInfoPlistRuntimeVersion = "ExpoLynxRuntimeVersion"

  static func deploymentURL(feature: String) throws -> URL {
    guard let endpoints = Bundle.main.object(
      forInfoDictionaryKey: infoPlistDeliveryEndpoints
    ) as? [String: Any],
      let value = endpoints[feature] as? String,
      let url = URL(string: value),
      ["http", "https"].contains(url.scheme?.lowercased()),
      url.user == nil,
      url.password == nil,
      url.query == nil,
      url.fragment == nil
    else {
      throw LynxDeliveryError(
        stage: .manifest,
        code: "ERR_LYNX_DEPLOYMENT_CONFIGURATION",
        message: "No build-time Lynx deployment endpoint is configured for \(feature)."
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

  static func runtimeVersion() throws -> String {
    let value = (Bundle.main.object(forInfoDictionaryKey: infoPlistRuntimeVersion) as? String)
      ?? (Bundle.main.object(forInfoDictionaryKey: legacyInfoPlistRuntimeVersion) as? String)
    guard let value, !value.isEmpty, value.utf8.count <= 128, !value.contains("\0") else {
      throw LynxDeliveryError(
        stage: .compatibility,
        code: "ERR_LYNX_RUNTIME_CONFIGURATION",
        message: "No build-time runtime version is configured for managed Lynx delivery."
      )
    }
    return value
  }
}

struct LynxManagedUpdateCheckResult: Sendable {
  enum Status: String, Sendable {
    case disabled
    case noUpdate = "no-update"
    case pending
    case reloaded
  }

  let feature: String
  let status: Status
  let releaseID: String?
  let version: String?
  let revision: Int?

  func eventPayload(phase: String) -> [String: Any] {
    var payload: [String: Any] = ["feature": feature, "phase": phase]
    if let releaseID { payload["releaseId"] = releaseID }
    if let version { payload["version"] = version }
    if let revision { payload["revision"] = revision }
    return payload
  }

  func modulePayload() -> [String: Any] {
    var payload: [String: Any] = ["feature": feature, "status": status.rawValue]
    if let releaseID { payload["releaseId"] = releaseID }
    if let version { payload["version"] = version }
    if let revision { payload["revision"] = revision }
    return payload
  }
}

actor LynxManagedDeliveryCoordinator {
  static let shared = LynxManagedDeliveryCoordinator()

  private struct UpdateKey: Hashable {
    let feature: String
    let deploymentURL: String
  }

  private struct InFlightUpdate {
    let id: UUID
    let task: Task<LynxManagedUpdateCheckResult, Error>
  }

  private var inFlightUpdates: [UpdateKey: InFlightUpdate] = [:]

  func checkForUpdate(feature: String) async throws -> LynxManagedUpdateCheckResult {
    let deploymentURL = try LynxManagedDeliveryConfiguration.deploymentURL(feature: feature)
    return try await checkForUpdate(feature: feature, deploymentURL: deploymentURL)
  }

  func checkForUpdate(
    feature: String,
    deploymentURL: URL
  ) async throws -> LynxManagedUpdateCheckResult {
    let key = UpdateKey(
      feature: feature,
      deploymentURL: deploymentURL.absoluteString
    )
    if let update = inFlightUpdates[key] {
      return try await update.task.value
    }

    // The shared task owns the complete transaction, including state changes
    // and view reloads. Cancelling one caller must not interrupt other views
    // waiting for the same feature and endpoint.
    let id = UUID()
    let task = Task {
      do {
        let result = try await self.performCheckForUpdate(
          feature: feature,
          deploymentURL: deploymentURL
        )
        await self.reconcileCache(feature: feature)
        return result
      } catch {
        await self.reconcileCache(feature: feature)
        throw error
      }
    }
    inFlightUpdates[key] = InFlightUpdate(id: id, task: task)

    do {
      let result = try await task.value
      removeInFlightUpdate(id: id, key: key)
      return result
    } catch {
      removeInFlightUpdate(id: id, key: key)
      throw error
    }
  }

  private func removeInFlightUpdate(id: UUID, key: UpdateKey) {
    guard inFlightUpdates[key]?.id == id else { return }
    inFlightUpdates.removeValue(forKey: key)
  }

  private func reconcileCache(feature: String) async {
    let state = await LynxManagedDeploymentState.shared.recover(feature: feature)
    try? await LynxManagedBundleStore.shared.reconcile(
      feature: feature,
      protectedReleaseIDs: state.protectedReleaseIDs
    )
  }

  private func performCheckForUpdate(
    feature: String,
    deploymentURL: URL
  ) async throws -> LynxManagedUpdateCheckResult {
    let state = await LynxManagedDeploymentState.shared.recover(feature: feature)
    let result = try await LynxManagedBundleStore.shared.checkForUpdate(
      deploymentURL: deploymentURL,
      expectedFeature: feature,
      expectedRuntimeVersion: try LynxManagedDeliveryConfiguration.runtimeVersion(),
      eTag: state.lastETag,
      lastRevision: state.lastRevision,
      blockedReleaseIDs: Set(state.failedReleaseIDs)
    )

    switch result {
    case let .notModified(eTag):
      await LynxManagedDeploymentState.shared.recordDeploymentCheck(
        eTag: eTag,
        revision: nil,
        feature: feature
      )
      return LynxManagedUpdateCheckResult(
        feature: feature,
        status: .noUpdate,
        releaseID: nil,
        version: nil,
        revision: state.lastRevision
      )

    case let .disabled(eTag, revision):
      await LynxManagedDeploymentState.shared.recordDeploymentCheck(
        eTag: eTag,
        revision: revision,
        feature: feature
      )
      return LynxManagedUpdateCheckResult(
        feature: feature,
        status: .disabled,
        releaseID: nil,
        version: nil,
        revision: revision
      )

    case let .blocked(releaseID, eTag, revision):
      await LynxManagedDeploymentState.shared.recordDeploymentCheck(
        eTag: eTag,
        revision: revision,
        feature: feature
      )
      return LynxManagedUpdateCheckResult(
        feature: feature,
        status: .noUpdate,
        releaseID: releaseID,
        version: nil,
        revision: revision
      )

    case let .selected(release, force, eTag, revision, _):
      // Consume the authenticated revision before installation or view work so
      // a repeated force response can never reload twice after interruption.
      await LynxManagedDeploymentState.shared.recordDeploymentCheck(
        eTag: eTag,
        revision: revision,
        feature: feature
      )
      let latest = await LynxManagedDeploymentState.shared.recover(feature: feature)

      if !force {
        guard latest.activeReleaseID != release.manifestID,
          latest.pendingReleaseID != release.manifestID
        else {
          return LynxManagedUpdateCheckResult(
            feature: feature,
            status: .noUpdate,
            releaseID: release.manifestID,
            version: release.version,
            revision: revision
          )
        }
        await LynxManagedDeploymentState.shared.stage(
          releaseID: release.manifestID,
          feature: feature
        )
        return LynxManagedUpdateCheckResult(
          feature: feature,
          status: .pending,
          releaseID: release.manifestID,
          version: release.version,
          revision: revision
        )
      }

      let mounted = await LynxManagedViewRegistry.shared.hasMountedView(feature: feature)
      guard mounted else {
        await LynxManagedDeploymentState.shared.stage(
          releaseID: release.manifestID,
          feature: feature
        )
        return LynxManagedUpdateCheckResult(
          feature: feature,
          status: .pending,
          releaseID: release.manifestID,
          version: release.version,
          revision: revision
        )
      }

      await LynxManagedDeploymentState.shared.beginAttempt(
        releaseID: release.manifestID,
        feature: feature
      )
      do {
        try await LynxManagedViewRegistry.shared.reloadMountedViews(
          feature: feature,
          release: release
        )
        await LynxManagedDeploymentState.shared.confirm(
          releaseID: release.manifestID,
          feature: feature
        )
        return LynxManagedUpdateCheckResult(
          feature: feature,
          status: .reloaded,
          releaseID: release.manifestID,
          version: release.version,
          revision: revision
        )
      } catch {
        await LynxManagedDeploymentState.shared.fail(
          releaseID: release.manifestID,
          feature: feature
        )
        throw error
      }
    }
  }
}
