import Foundation

@main
struct LynxArchiveExtractorFixtureTest {
  static func main() throws {
    let args = CommandLine.arguments
    guard args.count == 5 else { fatalError("usage: test <archive> <destination> <bundle-bytes> <asset-bytes>") }
    let archive = URL(fileURLWithPath: args[1])
    let destination = URL(fileURLWithPath: args[2], isDirectory: true)
    let expected = [
      LynxArchiveExpectedFile(path: "main.lynx.bundle", bytes: Int64(args[3])!, sha256: String(repeating: "0", count: 64)),
      LynxArchiveExpectedFile(path: "static/logo.txt", bytes: Int64(args[4])!, sha256: String(repeating: "0", count: 64)),
    ]
    try LynxSafeArchive.extract(archiveURL: archive, to: destination, expectedFiles: expected)
    guard FileManager.default.fileExists(atPath: destination.appendingPathComponent("main.lynx.bundle").path),
      FileManager.default.fileExists(atPath: destination.appendingPathComponent("static/logo.txt").path)
    else { fatalError("archive did not extract expected files") }
    print("Lynx archive fixture passed")
  }
}
