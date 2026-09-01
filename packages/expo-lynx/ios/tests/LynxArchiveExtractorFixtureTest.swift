import Foundation

@main
struct LynxArchiveExtractorFixtureTest {
  static func main() throws {
    let args = CommandLine.arguments
    guard args.count == 3 else { fatalError("usage: test <archive> <destination>") }
    let archive = URL(fileURLWithPath: args[1])
    let destination = URL(fileURLWithPath: args[2], isDirectory: true)
    try LynxSafeArchive.extract(archiveURL: archive, to: destination)
    guard FileManager.default.fileExists(atPath: destination.appendingPathComponent("main.lynx.bundle").path),
      FileManager.default.fileExists(atPath: destination.appendingPathComponent("static/logo.txt").path)
    else { fatalError("archive did not extract expected files") }
    print("Lynx archive fixture passed")
  }
}
