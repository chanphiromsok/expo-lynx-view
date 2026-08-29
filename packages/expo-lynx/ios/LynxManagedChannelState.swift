import Foundation

struct LynxManagedState: Codable, Sendable {
  var activeManifestID: String?
  var previousManifestID: String?
  var pendingManifestID: String?
  var attemptingManifestID: String?
  var failedManifestIDs: [String]
  var lastCheckedAt: String? = nil
  var lastETag: String? = nil
  var lastRevision: Int? = nil

  static let empty = LynxManagedState(failedManifestIDs: [])
}

actor LynxManagedChannelState {
  static let shared = LynxManagedChannelState()

  private let defaults = UserDefaults.standard
  private let prefix = "expo.lynx.managed.v1"
  private var recoveredKeys = Set<String>()

  func recover(feature: String, channel: String) -> LynxManagedState {
    let storageKey = key(feature: feature, channel: channel)
    var state = read(feature: feature, channel: channel)
    guard recoveredKeys.insert(storageKey).inserted else { return state }
    if let interrupted = state.attemptingManifestID {
      if !state.failedManifestIDs.contains(interrupted) {
        state.failedManifestIDs.append(interrupted)
      }
      state.attemptingManifestID = nil
      write(state, feature: feature, channel: channel)
    }
    return state
  }

  func beginAttempt(manifestID: String, feature: String, channel: String) {
    var state = read(feature: feature, channel: channel)
    state.previousManifestID = state.activeManifestID
    state.pendingManifestID = nil
    state.attemptingManifestID = manifestID
    write(state, feature: feature, channel: channel)
  }

  func confirm(manifestID: String, feature: String, channel: String) {
    var state = read(feature: feature, channel: channel)
    guard state.attemptingManifestID == manifestID else { return }
    state.activeManifestID = manifestID
    state.attemptingManifestID = nil
    state.pendingManifestID = nil
    write(state, feature: feature, channel: channel)
  }

  func fail(manifestID: String, feature: String, channel: String) {
    var state = read(feature: feature, channel: channel)
    if !state.failedManifestIDs.contains(manifestID) {
      state.failedManifestIDs.append(manifestID)
    }
    if state.activeManifestID == manifestID {
      state.activeManifestID = state.previousManifestID
      state.previousManifestID = nil
    }
    if state.attemptingManifestID == manifestID { state.attemptingManifestID = nil }
    if state.pendingManifestID == manifestID { state.pendingManifestID = nil }
    write(state, feature: feature, channel: channel)
  }

  func stage(manifestID: String, feature: String, channel: String) {
    var state = read(feature: feature, channel: channel)
    guard state.activeManifestID != manifestID,
      !state.failedManifestIDs.contains(manifestID)
    else { return }
    state.pendingManifestID = manifestID
    write(state, feature: feature, channel: channel)
  }

  func isFailed(manifestID: String, feature: String, channel: String) -> Bool {
    read(feature: feature, channel: channel).failedManifestIDs.contains(manifestID)
  }

  func recordChannelCheck(
    eTag: String?,
    revision: Int?,
    feature: String,
    channel: String
  ) {
    var state = read(feature: feature, channel: channel)
    state.lastCheckedAt = ISO8601DateFormatter().string(from: Date())
    if let eTag { state.lastETag = eTag }
    if let revision { state.lastRevision = revision }
    write(state, feature: feature, channel: channel)
  }

  private func read(feature: String, channel: String) -> LynxManagedState {
    guard let data = defaults.data(forKey: key(feature: feature, channel: channel)),
      let state = try? JSONDecoder().decode(LynxManagedState.self, from: data)
    else { return .empty }
    return state
  }

  private func write(_ state: LynxManagedState, feature: String, channel: String) {
    guard let data = try? JSONEncoder().encode(state) else { return }
    defaults.set(data, forKey: key(feature: feature, channel: channel))
  }

  private func key(feature: String, channel: String) -> String {
    "\(prefix).\(feature).\(channel)"
  }
}
