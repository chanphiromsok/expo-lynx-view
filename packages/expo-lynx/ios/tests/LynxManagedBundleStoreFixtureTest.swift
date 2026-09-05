import CryptoKit
import Foundation

@main
struct LynxManagedBundleStoreFixtureTest {
  static func main() async throws {
    let fileManager = FileManager.default
    let root = fileManager.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? fileManager.removeItem(at: root) }

    let feature = "delivery"
    let runtime = "runtime-a"
    let active = "release-active"
    try complete(root: root, feature: feature, runtime: runtime, releaseID: active, date: .distantPast)
    for index in 1...4 {
      try complete(
        root: root,
        feature: feature,
        runtime: runtime,
        releaseID: "release-\(index)",
        date: Date(timeIntervalSinceReferenceDate: TimeInterval(index))
      )
    }

    let staleStaging = root.appendingPathComponent("delivery/staging/interrupted", isDirectory: true)
    try fileManager.createDirectory(at: staleStaging, withIntermediateDirectories: true)
    let incomplete = readyURL(root: root, feature: feature, runtime: runtime, releaseID: "incomplete")
    try fileManager.createDirectory(at: incomplete, withIntermediateDirectories: true)
    try Data().write(to: incomplete.appendingPathComponent("main.lynx.bundle"))

    let otherFeatureRelease = "release-orders"
    try complete(
      root: root,
      feature: "orders",
      runtime: runtime,
      releaseID: otherFeatureRelease,
      date: .now
    )
    let sameIDOtherRuntime = "release-active"
    try complete(
      root: root,
      feature: feature,
      runtime: "runtime-b",
      releaseID: sameIDOtherRuntime,
      date: .now
    )

    let store = LynxManagedBundleStore(rootURL: root)
    try await store.reconcile(
      feature: feature,
      runtimeVersion: runtime,
      protectedReleaseIDs: [active]
    )

    guard store.launchInstalledRelease(
      feature: feature,
      releaseID: active,
      expectedRuntimeVersion: runtime
    ) != nil else {
      fatalError("Expected protected complete release to survive reconciliation")
    }
    guard !fileManager.fileExists(atPath: staleStaging.path),
      !fileManager.fileExists(atPath: incomplete.path),
      !fileManager.fileExists(atPath: readyURL(root: root, feature: feature, runtime: runtime, releaseID: "release-1").path)
    else {
      fatalError("Expected interrupted, incomplete, and oldest unprotected cache entries to be removed")
    }
    guard fileManager.fileExists(
      atPath: readyURL(root: root, feature: "orders", runtime: runtime, releaseID: otherFeatureRelease).path
    ), store.launchInstalledRelease(
      feature: feature,
      releaseID: sameIDOtherRuntime,
      expectedRuntimeVersion: "runtime-b"
    ) != nil else {
      fatalError("Expected feature and runtime cache namespaces to remain isolated")
    }
  }

  private static func complete(
    root: URL,
    feature: String,
    runtime: String,
    releaseID: String,
    date: Date
  ) throws {
    let directory = readyURL(root: root, feature: feature, runtime: runtime, releaseID: releaseID)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try Data("bundle".utf8).write(to: directory.appendingPathComponent("main.lynx.bundle"))
    let completion = V2Completion(
      feature: feature,
      releaseID: releaseID,
      version: "1.0.0",
      runtimeVersion: runtime,
      archiveSHA256: String(repeating: "0", count: 64)
    )
    try JSONEncoder().encode(completion).write(
      to: directory.appendingPathComponent("completion.json"),
      options: .atomic
    )
    try FileManager.default.setAttributes([.modificationDate: date], ofItemAtPath: directory.path)
  }

  private static func readyURL(root: URL, feature: String, runtime: String, releaseID: String) -> URL {
    root
      .appendingPathComponent(feature, isDirectory: true)
      .appendingPathComponent("ready", isDirectory: true)
      .appendingPathComponent(runtimeKey(runtime), isDirectory: true)
      .appendingPathComponent(releaseID, isDirectory: true)
  }

  private static func runtimeKey(_ runtime: String) -> String {
    SHA256.hash(data: Data(runtime.utf8)).map { String(format: "%02x", $0) }.joined()
  }
}
