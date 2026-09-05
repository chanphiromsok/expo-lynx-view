import CryptoKit
import Foundation

@main
@MainActor
struct LynxManagedDeploymentStateFixtureTest {
  static func main() {
    let suite = "expo.lynx.state-fixture.\(UUID().uuidString)"
    let storeID = "expo.lynx.state-fixture.\(UUID().uuidString)"
    let storeRoot = FileManager.default.temporaryDirectory
      .appendingPathComponent("expo-lynx-state-fixture-\(UUID().uuidString)", isDirectory: true)
    guard let defaults = UserDefaults(suiteName: suite) else {
      fatalError("Expected an isolated UserDefaults suite")
    }
    defer {
      defaults.removePersistentDomain(forName: suite)
      try? FileManager.default.removeItem(at: storeRoot)
    }

    let feature = "delivery"
    let runtime = "runtime-a"
    let stable = "release-stable"
    let broken = "release-broken"

    let beforeTermination = LynxManagedDeploymentState(
      storeID: storeID,
      storeRoot: storeRoot,
      legacyDefaults: defaults
    )
    beforeTermination.beginAttempt(
      releaseID: stable,
      feature: feature,
      runtimeVersion: runtime
    )
    beforeTermination.confirm(
      releaseID: stable,
      feature: feature,
      runtimeVersion: runtime
    )
    beforeTermination.stage(
      releaseID: broken,
      feature: feature,
      runtimeVersion: runtime
    )
    beforeTermination.beginAttempt(
      releaseID: broken,
      feature: feature,
      runtimeVersion: runtime
    )

    // A fresh instance represents the next app launch after the process died
    // while the broken candidate was rendering.
    let afterTermination = LynxManagedDeploymentState(
      storeID: storeID,
      storeRoot: storeRoot,
      legacyDefaults: defaults
    )
    let recovered = afterTermination.recover(feature: feature, runtimeVersion: runtime)
    guard recovered.activeReleaseID == stable,
      recovered.previousReleaseID == stable,
      recovered.pendingReleaseID == nil,
      recovered.attemptingReleaseID == nil,
      recovered.failedReleaseIDs == [broken],
      afterTermination.isFailed(releaseID: broken, feature: feature, runtimeVersion: runtime)
    else {
      fatalError("Expected interrupted candidate recovery to retain the last-known-good release")
    }

    afterTermination.stage(releaseID: broken, feature: feature, runtimeVersion: runtime)
    let repeatedRecovery = afterTermination.recover(feature: feature, runtimeVersion: runtime)
    guard repeatedRecovery.pendingReleaseID == nil,
      repeatedRecovery.failedReleaseIDs == [broken]
    else {
      fatalError("Expected a failed immutable release to remain blocked without duplication")
    }

    let otherRuntime = afterTermination.recover(feature: feature, runtimeVersion: "runtime-b")
    guard otherRuntime.activeReleaseID == nil,
      otherRuntime.previousReleaseID == nil,
      otherRuntime.pendingReleaseID == nil,
      otherRuntime.attemptingReleaseID == nil,
      otherRuntime.failedReleaseIDs.isEmpty
    else {
      fatalError("Expected recovery state to remain isolated by runtime")
    }

    let legacyRuntime = "runtime-legacy"
    let legacyScope = stateKey(feature: feature, runtimeVersion: legacyRuntime)
    let legacyState = LynxManagedState(
      activeReleaseID: stable,
      previousReleaseID: nil,
      pendingReleaseID: nil,
      attemptingReleaseID: nil,
      failedReleaseIDs: [],
      lastETag: "legacy-etag",
      lastRevision: 7
    )
    guard let legacyData = try? JSONEncoder().encode(legacyState) else {
      fatalError("Expected legacy state to encode")
    }
    defaults.set(legacyData, forKey: legacyScope)

    let migrated = LynxManagedDeploymentState(
      storeID: storeID,
      storeRoot: storeRoot,
      legacyDefaults: defaults
    ).recover(feature: feature, runtimeVersion: legacyRuntime)
    guard migrated.activeReleaseID == stable,
      migrated.lastETag == "legacy-etag",
      migrated.lastRevision == 7,
      defaults.data(forKey: legacyScope) == nil
    else {
      fatalError("Expected legacy UserDefaults state to migrate atomically into MMKV")
    }
  }

  private static func stateKey(feature: String, runtimeVersion: String) -> String {
    let runtimeScope = SHA256.hash(data: Data(runtimeVersion.utf8))
      .map { String(format: "%02x", $0) }
      .joined()
    return "expo.lynx.managed.v3.\(runtimeScope).\(feature)"
  }
}
