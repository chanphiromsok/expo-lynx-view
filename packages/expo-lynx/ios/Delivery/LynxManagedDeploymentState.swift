import CryptoKit
import Foundation
import MMKV
import OSLog

struct LynxManagedState: Codable, Sendable {
  var activeReleaseID: String?
  var previousReleaseID: String?
  var pendingReleaseID: String?
  var attemptingReleaseID: String?
  var failedReleaseIDs: [String]
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

  private static var didInitializeMMKV = false
  private static let log = Logger(subsystem: "expo.lynx.delivery", category: "state")

  private let store: MMKV?
  private let prefix = "expo.lynx.managed.v3"
  private var recoveredScopes = Set<String>()
  // Per-scope blob held only when MMKV cannot persist it this launch. Keeps the
  // running session self-consistent; discarded when the process exits.
  private var memoryFallback: [String: LynxManagedState] = [:]

  static func prepareStorage() {
    #if DEBUG
      MainActor.assertIsolated()
    #endif
    guard !didInitializeMMKV else { return }
    _ = MMKV.initialize(rootDir: nil)
    didInitializeMMKV = true
  }

  init(
    storeID: String = "expo.lynx.managed.v3",
    storeRoot: URL? = nil
  ) {
    Self.prepareStorage()
    let root = storeRoot ?? Self.defaultStoreRoot
    try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    self.store = MMKV(mmapID: storeID, rootPath: root.path)
  }

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
    let scope = key(feature: feature, runtimeVersion: runtimeVersion)
    var state = read(scope: scope)
    state.previousReleaseID = state.activeReleaseID
    state.pendingReleaseID = nil
    state.attemptingReleaseID = releaseID
    write(state, scope: scope)
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
    if let eTag { state.lastETag = eTag }
    if let revision { state.lastRevision = revision }
    write(state, scope: scope)
  }

  private func read(scope: String) -> LynxManagedState {
    if let data = store?.data(forKey: scope) {
      return decode(data)
    }
    return memoryFallback[scope] ?? .empty
  }

  private func decode(_ data: Data) -> LynxManagedState {
    guard let state = try? JSONDecoder().decode(LynxManagedState.self, from: data) else {
      return .empty
    }
    return state
  }

  private func write(_ state: LynxManagedState, scope: String) {
    guard let data = try? JSONEncoder().encode(state) else { return }
    if store?.set(data, forKey: scope) == true {
      memoryFallback[scope] = nil
      return
    }
    // MMKV is unavailable this launch (mmap failed) or rejected the write. Retain
    // the blob in memory so a fail() during a bad rollout is not forgotten and the
    // broken release cannot retry within this session; recover() rebuilds durable
    // state from the embedded bundle on the next launch.
    memoryFallback[scope] = state
    Self.log.error(
      "mmkv_write_failed scope=\(scope, privacy: .public); holding delivery state in memory for this session"
    )
  }

  private static var defaultStoreRoot: URL {
    FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("ExpoLynx/MMKV", isDirectory: true)
  }

  private func key(feature: String, runtimeVersion: String) -> String {
    let bytes = SHA256.hash(data: Data(runtimeVersion.utf8))
    let runtimeScope = bytes.map { String(format: "%02x", $0) }.joined()
    return "\(prefix).\(runtimeScope).\(feature)"
  }
}
