import CryptoKit
import Foundation

struct LynxManagedState: Codable, Sendable {
  var activeReleaseID: String?
  var previousReleaseID: String?
  var pendingReleaseID: String?
  var attemptingReleaseID: String?
  var failedReleaseIDs: [String]
  var lastCheckedAt: String? = nil
  var lastETag: String? = nil
  var lastRevision: Int? = nil

  static let empty = LynxManagedState(failedReleaseIDs: [])

  var protectedReleaseIDs: Set<String> {
    Set([
      activeReleaseID,
      previousReleaseID,
      pendingReleaseID,
      attemptingReleaseID,
    ].compactMap { $0 })
  }
}

@MainActor
final class LynxManagedDeploymentState {
  static let shared = LynxManagedDeploymentState()

  private let defaults = UserDefaults.standard
  private let prefix = "expo.lynx.managed.v3"
  private var recoveredScopes = Set<String>()

  func recover(feature: String, runtimeVersion: String) -> LynxManagedState {
    let scope = key(feature: feature, runtimeVersion: runtimeVersion)
    var state = read(scope: scope)
    guard recoveredScopes.insert(scope).inserted else { return state }
    if let interrupted = state.attemptingReleaseID {
      if !state.failedReleaseIDs.contains(interrupted) {
        state.failedReleaseIDs.append(interrupted)
      }
      state.attemptingReleaseID = nil
      write(state, scope: scope)
    }
    return state
  }

  func beginAttempt(releaseID: String, feature: String, runtimeVersion: String) {
    var state = read(scope: key(feature: feature, runtimeVersion: runtimeVersion))
    state.previousReleaseID = state.activeReleaseID
    state.pendingReleaseID = nil
    state.attemptingReleaseID = releaseID
    write(state, scope: key(feature: feature, runtimeVersion: runtimeVersion))
  }

  func confirm(releaseID: String, feature: String, runtimeVersion: String) {
    let scope = key(feature: feature, runtimeVersion: runtimeVersion)
    var state = read(scope: scope)
    guard state.attemptingReleaseID == releaseID else { return }
    state.activeReleaseID = releaseID
    state.attemptingReleaseID = nil
    state.pendingReleaseID = nil
    write(state, scope: scope)
  }

  func fail(releaseID: String, feature: String, runtimeVersion: String) {
    let scope = key(feature: feature, runtimeVersion: runtimeVersion)
    var state = read(scope: scope)
    if !state.failedReleaseIDs.contains(releaseID) {
      state.failedReleaseIDs.append(releaseID)
    }
    if state.activeReleaseID == releaseID {
      state.activeReleaseID = state.previousReleaseID
      state.previousReleaseID = nil
    }
    if state.attemptingReleaseID == releaseID { state.attemptingReleaseID = nil }
    if state.pendingReleaseID == releaseID { state.pendingReleaseID = nil }
    write(state, scope: scope)
  }

  func stage(releaseID: String, feature: String, runtimeVersion: String) {
    let scope = key(feature: feature, runtimeVersion: runtimeVersion)
    var state = read(scope: scope)
    guard state.activeReleaseID != releaseID,
      !state.failedReleaseIDs.contains(releaseID)
    else { return }
    state.pendingReleaseID = releaseID
    write(state, scope: scope)
  }

  func isFailed(releaseID: String, feature: String, runtimeVersion: String) -> Bool {
    read(scope: key(feature: feature, runtimeVersion: runtimeVersion)).failedReleaseIDs.contains(releaseID)
  }

  func recordDeploymentCheck(eTag: String?, revision: Int?, feature: String, runtimeVersion: String) {
    let scope = key(feature: feature, runtimeVersion: runtimeVersion)
    var state = read(scope: scope)
    state.lastCheckedAt = ISO8601DateFormatter().string(from: Date())
    if let eTag { state.lastETag = eTag }
    if let revision { state.lastRevision = revision }
    write(state, scope: scope)
  }

  private func read(scope: String) -> LynxManagedState {
    guard let data = defaults.data(forKey: scope),
      let state = try? JSONDecoder().decode(LynxManagedState.self, from: data)
    else { return .empty }
    return state
  }

  private func write(_ state: LynxManagedState, scope: String) {
    guard let data = try? JSONEncoder().encode(state) else { return }
    defaults.set(data, forKey: scope)
  }

  private func key(feature: String, runtimeVersion: String) -> String {
    let bytes = SHA256.hash(data: Data(runtimeVersion.utf8))
    let runtimeScope = bytes.map { String(format: "%02x", $0) }.joined()
    return "\(prefix).\(runtimeScope).\(feature)"
  }
}
