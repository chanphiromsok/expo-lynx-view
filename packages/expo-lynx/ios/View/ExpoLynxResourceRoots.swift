import Foundation

/// Process-wide registry of directories that Lynx resource resolution is
/// allowed to read from, in addition to the app bundle.
///
/// Exists because a prewarmed `LynxBackgroundRuntime` has its resource fetchers
/// baked in at construction (`LynxBackgroundRuntimeOptions`
/// `templateResourceFetcher` / `genericResourceFetcher` / `mediaResourceFetcher`
/// are set before the runtime is built, with no setter afterwards). The only
/// fetcher a prewarmed runtime can hold is `ExpoLynxTemplateProvider.shared` —
/// an instance with no view and therefore no per-view root. Routing every
/// provider through this registry means the warm-runtime path (F4) and the
/// per-view path resolve identically.
///
/// Roots are kept per owner, newest first, with the immediately-previous root
/// retained so that resource fetches still in flight from a superseded load
/// keep resolving (F7). Entries are dropped when the owning view tears down.
///
/// `@unchecked Sendable`: every access goes through `lock`.
final class ExpoLynxResourceRoots: @unchecked Sendable {
  static let shared = ExpoLynxResourceRoots()

  private let lock = NSLock()
  private var rootsByOwner: [ObjectIdentifier: [URL]] = [:]
  private var ownerOrder: [ObjectIdentifier] = []

  /// Retain at most the current and immediately-previous root per owner.
  private static let historyDepth = 2

  func setRoot(_ url: URL?, owner: ObjectIdentifier) {
    lock.lock()
    defer { lock.unlock() }

    ownerOrder.removeAll { $0 == owner }
    ownerOrder.insert(owner, at: 0)

    guard let url else {
      rootsByOwner[owner] = []
      return
    }
    var history = rootsByOwner[owner] ?? []
    history.removeAll { $0 == url }
    history.insert(url, at: 0)
    rootsByOwner[owner] = Array(history.prefix(Self.historyDepth))
  }

  func removeOwner(_ owner: ObjectIdentifier) {
    lock.lock()
    defer { lock.unlock() }
    rootsByOwner.removeValue(forKey: owner)
    ownerOrder.removeAll { $0 == owner }
  }

  /// Most-recently-active owner first, then that owner's newest root first.
  func currentRoots() -> [URL] {
    lock.lock()
    defer { lock.unlock() }
    return ownerOrder.flatMap { rootsByOwner[$0] ?? [] }
  }
}
