import CryptoKit
import Foundation

@main
@MainActor
struct LynxManagedDeploymentStateFixtureTest {
  static func main() {
    let storeID = "expo.lynx.state-fixture.\(UUID().uuidString)"
    let storeRoot = FileManager.default.temporaryDirectory
      .appendingPathComponent("expo-lynx-state-fixture-\(UUID().uuidString)", isDirectory: true)
    defer {
      try? FileManager.default.removeItem(at: storeRoot)
    }

    let feature = "delivery"
    let runtime = "runtime-a"
    let stable = "release-stable"
    let broken = "release-broken"

    let beforeTermination = LynxManagedDeploymentState(
      storeID: storeID,
      storeRoot: storeRoot
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
      storeRoot: storeRoot
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

    let reopened = LynxManagedDeploymentState(
      storeID: storeID,
      storeRoot: storeRoot
    ).recover(feature: feature, runtimeVersion: runtime)
    guard reopened.activeReleaseID == stable,
      reopened.failedReleaseIDs == [broken]
    else {
      fatalError("Expected MMKV state to persist across store instances")
    }
  }
}
