import Foundation

@MainActor
final class LynxManagedViewRegistry {
  static let shared = LynxManagedViewRegistry()

  private final class WeakView {
    weak var value: ExpoLynxView?

    init(_ value: ExpoLynxView) {
      self.value = value
    }
  }

  private var views: [ObjectIdentifier: WeakView] = [:]

  func register(_ view: ExpoLynxView) {
    views[ObjectIdentifier(view)] = WeakView(view)
    removeReleasedViews()
  }

  func unregister(_ view: ExpoLynxView) {
    views.removeValue(forKey: ObjectIdentifier(view))
  }

  func hasMountedView(feature: String) -> Bool {
    matchingViews(feature: feature).isEmpty == false
  }

  func reloadMountedViews(
    feature: String,
    release: LynxManagedRelease
  ) async throws {
    let mountedViews = matchingViews(feature: feature)
    guard !mountedViews.isEmpty else { return }
    try await withCheckedThrowingContinuation { continuation in
      let completion = ReloadCompletion(
        remaining: mountedViews.count,
        continuation: continuation
      )
      for view in mountedViews {
        view.forceReloadManagedRelease(release) { result in
          completion.complete(result)
        }
      }
    }
  }

  private func matchingViews(feature: String) -> [ExpoLynxView] {
    removeReleasedViews()
    return views.values.compactMap(\.value).filter {
      $0.mountedManagedFeature == feature
    }
  }

  private func removeReleasedViews() {
    views = views.filter { $0.value.value != nil }
  }
}

@MainActor
private final class ReloadCompletion {
  private var remaining: Int
  private var finished = false
  private let continuation: CheckedContinuation<Void, Error>

  init(remaining: Int, continuation: CheckedContinuation<Void, Error>) {
    self.remaining = remaining
    self.continuation = continuation
  }

  func complete(_ result: Result<Void, Error>) {
    guard !finished else { return }
    switch result {
    case .success:
      remaining -= 1
      if remaining == 0 {
        finished = true
        continuation.resume()
      }
    case let .failure(error):
      finished = true
      continuation.resume(throwing: error)
    }
  }
}
