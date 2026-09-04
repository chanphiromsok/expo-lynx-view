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
  private let prefix = "expo.lynx.managed.v2"
  private var recoveredFeatures = Set<String>()

  func recover(feature: String) -> LynxManagedState {
    var state = read(feature: feature)
    guard recoveredFeatures.insert(feature).inserted else { return state }
    if let interrupted = state.attemptingReleaseID {
      if !state.failedReleaseIDs.contains(interrupted) {
        state.failedReleaseIDs.append(interrupted)
      }
      state.attemptingReleaseID = nil
      write(state, feature: feature)
    }
    return state
  }

  func beginAttempt(releaseID: String, feature: String) {
    var state = read(feature: feature)
    state.previousReleaseID = state.activeReleaseID
    state.pendingReleaseID = nil
    state.attemptingReleaseID = releaseID
    write(state, feature: feature)
  }

  func confirm(releaseID: String, feature: String) {
    var state = read(feature: feature)
    guard state.attemptingReleaseID == releaseID else { return }
    state.activeReleaseID = releaseID
    state.attemptingReleaseID = nil
    state.pendingReleaseID = nil
    write(state, feature: feature)
  }

  func fail(releaseID: String, feature: String) {
    var state = read(feature: feature)
    if !state.failedReleaseIDs.contains(releaseID) {
      state.failedReleaseIDs.append(releaseID)
    }
    if state.activeReleaseID == releaseID {
      state.activeReleaseID = state.previousReleaseID
      state.previousReleaseID = nil
    }
    if state.attemptingReleaseID == releaseID { state.attemptingReleaseID = nil }
    if state.pendingReleaseID == releaseID { state.pendingReleaseID = nil }
    write(state, feature: feature)
  }

  func stage(releaseID: String, feature: String) {
    var state = read(feature: feature)
    guard state.activeReleaseID != releaseID,
      !state.failedReleaseIDs.contains(releaseID)
    else { return }
    state.pendingReleaseID = releaseID
    write(state, feature: feature)
  }

  func isFailed(releaseID: String, feature: String) -> Bool {
    read(feature: feature).failedReleaseIDs.contains(releaseID)
  }

  func recordDeploymentCheck(eTag: String?, revision: Int?, feature: String) {
    var state = read(feature: feature)
    state.lastCheckedAt = ISO8601DateFormatter().string(from: Date())
    if let eTag { state.lastETag = eTag }
    if let revision { state.lastRevision = revision }
    write(state, feature: feature)
  }

  private func read(feature: String) -> LynxManagedState {
    guard let data = defaults.data(forKey: key(feature: feature)),
      let state = try? JSONDecoder().decode(LynxManagedState.self, from: data)
    else { return .empty }
    return state
  }

  private func write(_ state: LynxManagedState, feature: String) {
    guard let data = try? JSONEncoder().encode(state) else { return }
    defaults.set(data, forKey: key(feature: feature))
  }

  private func key(feature: String) -> String {
    "\(prefix).\(feature)"
  }
}
