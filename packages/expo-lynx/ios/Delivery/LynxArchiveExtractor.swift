import Foundation
import zlib

enum LynxArchiveLimits {
  static let maxArchiveBytes: Int64 = 64 * 1024 * 1024
  static let maxUncompressedBytes: Int64 = 256 * 1024 * 1024
  static let maxSingleEntryBytes: Int64 = 64 * 1024 * 1024
  static let maxEntries = 4096
  static let maxCompressionRatio: Int64 = 100
  static let maxPathUTF8Bytes = 512
  static let maxPathDepth = 16
}

enum LynxSafeArchive {
  static func extract(
    archiveURL: URL,
    to directoryURL: URL
  ) throws {
    try LynxZipArchiveExtractor.extract(
      archiveURL: archiveURL,
      destinationURL: directoryURL
    )
  }
}

/// ZIP-only archive extractor. The archive SHA-256 is authenticated by the
/// signed deployment document; this layer defensively validates every ZIP
/// entry before extraction. Directories, links, ZIP64, and unsafe features are
/// rejected.
private enum LynxZipArchiveExtractor {
  private static let centralSignature: UInt32 = 0x02014b50
  private static let localSignature: UInt32 = 0x04034b50
  private static let endSignature: UInt32 = 0x06054b50
  private static let bufferSize = 64 * 1024

  struct Entry {
    let path: String
    let method: UInt16
    let flags: UInt16
    let compressedBytes: UInt64
    let bytes: UInt64
    let crc: UInt32
    let localOffset: UInt64
  }

  static func extract(
    archiveURL: URL,
    destinationURL: URL
  ) throws {
    let fileSize = try archiveURL.resourceValues(forKeys: [.fileSizeKey]).fileSize.map(Int64.init) ?? -1
    guard fileSize > 21, fileSize <= LynxArchiveLimits.maxArchiveBytes else { throw invalid("Archive size exceeds limits.") }
    let handle = try FileHandle(forReadingFrom: archiveURL)
    defer { try? handle.close() }
    let entries = try centralDirectory(handle: handle, fileSize: UInt64(fileSize))
    try FileManager.default.createDirectory(at: destinationURL, withIntermediateDirectories: true)
    var total: UInt64 = 0
    var seen = Set<String>()
    var storagePaths = Set<String>()
    var mainBundleCount = 0
    for entry in entries {
      guard seen.insert(entry.path).inserted else { throw invalid("Archive contains duplicate files.") }
      guard storagePaths.insert(entry.path.lowercased()).inserted else {
        throw invalid("Archive contains case-colliding files.")
      }
      if entry.path == "main.lynx.bundle" { mainBundleCount += 1 }
      total += entry.bytes
      guard total <= UInt64(LynxArchiveLimits.maxUncompressedBytes) else { throw invalid("Archive expanded size exceeds limits.") }
      try extract(entry: entry, archive: handle, destinationURL: destinationURL)
    }
    guard mainBundleCount == 1 else { throw invalid("Archive must contain exactly one main.lynx.bundle.") }
  }

  private static func centralDirectory(
    handle: FileHandle, fileSize: UInt64
  ) throws -> [Entry] {
    let tailCount = Int(min(fileSize, UInt64(65_557)))
    try handle.seek(toOffset: fileSize - UInt64(tailCount))
    let tail = try readExactly(handle, tailCount)
    guard let end = lastSignature(endSignature, in: tail), end + 22 <= tail.count,
      end + 22 + Int(tail.u16(end + 20)) == tail.count else { throw invalid("ZIP end record is malformed.") }
    let disk = tail.u16(end + 4), centralDisk = tail.u16(end + 6), count = tail.u16(end + 10)
    let centralBytes = tail.u32(end + 12), centralOffset = tail.u32(end + 16)
    guard disk == 0, centralDisk == 0, count != .max, centralBytes != .max, centralOffset != .max,
      count > 0, count <= LynxArchiveLimits.maxEntries,
      UInt64(centralOffset) + UInt64(centralBytes) <= fileSize else { throw invalid("ZIP64, multi-disk, or oversized ZIP is unsupported.") }
    try handle.seek(toOffset: UInt64(centralOffset))
    var entries: [Entry] = []
    for _ in 0..<count {
      let header = try readExactly(handle, 46)
      guard header.u32(0) == centralSignature else { throw invalid("ZIP central directory is invalid.") }
      let flags = header.u16(8), method = header.u16(10)
      let crc = header.u32(16), compressed = header.u32(20), bytes = header.u32(24)
      let nameLength = Int(header.u16(28)), extraLength = Int(header.u16(30)), commentLength = Int(header.u16(32)), localOffset = header.u32(42)
      let unixMode = UInt16((header.u32(38) >> 16) & 0xffff) & 0o170000
      // Bits 1–2 are normal DEFLATE compression-level hints (emitted by
      // macOS `zip -9`). Encryption and data-descriptor streams are rejected
      // because we require central/local sizes and CRCs to agree before write.
      guard flags & UInt16(0x0009) == 0, method == 0 || method == 8,
        compressed != .max, bytes != .max, localOffset != .max,
        unixMode != 0o040000, unixMode != 0o120000, unixMode != 0o060000,
        bytes <= LynxArchiveLimits.maxSingleEntryBytes,
        compressed > 0 ? bytes <= compressed * UInt32(LynxArchiveLimits.maxCompressionRatio) : bytes == 0 else { throw invalid("ZIP entry is encrypted, unsupported, or unsafe.") }
      let name = try readExactly(handle, nameLength)
      guard let path = String(data: name, encoding: .utf8), isSafePath(path), path.precomposedStringWithCanonicalMapping == path else { throw invalid("ZIP entry path is unsafe.") }
      try handle.seek(toOffset: handle.offsetInFile + UInt64(extraLength + commentLength))
      entries.append(Entry(path: path, method: method, flags: flags, compressedBytes: UInt64(compressed), bytes: UInt64(bytes), crc: crc, localOffset: UInt64(localOffset)))
    }
    return entries
  }

  private static func extract(entry: Entry, archive: FileHandle, destinationURL: URL) throws {
    try archive.seek(toOffset: entry.localOffset)
    let local = try readExactly(archive, 30)
    guard local.u32(0) == localSignature, local.u16(6) == entry.flags, local.u16(8) == entry.method,
      local.u32(14) == entry.crc, local.u32(18) == entry.compressedBytes, local.u32(22) == entry.bytes else { throw invalid("ZIP local header disagrees with central directory.") }
    let nameLength = Int(local.u16(26)), extraLength = Int(local.u16(28))
    let localName = try readExactly(archive, nameLength)
    guard String(data: localName, encoding: .utf8) == entry.path else { throw invalid("ZIP local path disagrees with central directory.") }
    try archive.seek(toOffset: archive.offsetInFile + UInt64(extraLength))
    let fileURL = destinationURL.appendingPathComponent(entry.path)
    guard fileURL.standardizedFileURL.path.hasPrefix(destinationURL.standardizedFileURL.path + "/") else { throw invalid("ZIP output escapes destination.") }
    try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    FileManager.default.createFile(atPath: fileURL.path, contents: nil)
    let output = try FileHandle(forWritingTo: fileURL)
    defer { try? output.close() }
    let result = try entry.method == 0 ? copyStored(archive, entry.compressedBytes, output) : inflate(archive, entry.compressedBytes, output)
    guard result.bytes == entry.bytes, result.crc == entry.crc else { throw invalid("ZIP entry CRC or length is invalid.") }
  }

  private static func copyStored(_ input: FileHandle, _ count: UInt64, _ output: FileHandle) throws -> (bytes: UInt64, crc: UInt32) {
    var remaining = count, total: UInt64 = 0, checksum = crc32(0, nil, 0)
    while remaining > 0 { let data = try readExactly(input, Int(min(remaining, UInt64(bufferSize)))); output.write(data); total += UInt64(data.count); remaining -= UInt64(data.count); checksum = data.withUnsafeBytes { crc32(checksum, $0.bindMemory(to: Bytef.self).baseAddress, uInt(data.count)) } }
    return (total, UInt32(checksum))
  }

  private static func inflate(_ input: FileHandle, _ count: UInt64, _ output: FileHandle) throws -> (bytes: UInt64, crc: UInt32) {
    var stream = z_stream()
    guard inflateInit2_(&stream, -MAX_WBITS, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK else {
      throw invalid("Cannot initialize ZIP inflater.")
    }
    defer { inflateEnd(&stream) }
    let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
    defer { buffer.deallocate() }
    var remaining = count, total: UInt64 = 0, checksum = crc32(0, nil, 0), ended = false
    while remaining > 0 && !ended {
      let data = try readExactly(input, Int(min(remaining, UInt64(bufferSize))))
      remaining -= UInt64(data.count)
      try data.withUnsafeBytes { raw in
        guard let base = raw.bindMemory(to: UInt8.self).baseAddress else { throw invalid("Empty ZIP input.") }
        stream.next_in = UnsafeMutablePointer(mutating: base)
        stream.avail_in = uInt(data.count)
        repeat {
          stream.next_out = buffer
          stream.avail_out = uInt(bufferSize)
          let status = zlib.inflate(&stream, Z_NO_FLUSH)
          guard status == Z_OK || status == Z_STREAM_END else { throw invalid("ZIP DEFLATE stream is invalid.") }
          let produced = bufferSize - Int(stream.avail_out)
          if produced > 0 {
            output.write(Data(bytes: buffer, count: produced))
            total += UInt64(produced)
            checksum = crc32(checksum, buffer, uInt(produced))
            if total > UInt64(LynxArchiveLimits.maxSingleEntryBytes) { throw invalid("ZIP entry exceeds limits.") }
          }
          if status == Z_STREAM_END {
            guard stream.avail_in == 0, remaining == 0 else { throw invalid("ZIP DEFLATE stream has trailing data.") }
            ended = true
          }
        } while stream.avail_in > 0 || stream.avail_out == 0
      }
    }
    guard ended || count == 0 else { throw invalid("ZIP DEFLATE stream is truncated.") }
    return (total, UInt32(checksum))
  }

  private static func readExactly(_ handle: FileHandle, _ count: Int) throws -> Data { guard let data = try handle.read(upToCount: count), data.count == count else { throw invalid("Archive is truncated.") }; return data }
  private static func isSafePath(_ path: String) -> Bool { guard !path.isEmpty, !path.hasPrefix("/"), !path.contains("\\"), !path.contains("\0"), !path.utf8.contains(0), path.utf8.count <= LynxArchiveLimits.maxPathUTF8Bytes, !(path.count >= 2 && path[path.index(after: path.startIndex)] == ":") else { return false }; let parts = path.split(separator: "/", omittingEmptySubsequences: false); return parts.count <= LynxArchiveLimits.maxPathDepth && parts.allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." } }
  private static func lastSignature(_ signature: UInt32, in data: Data) -> Int? { guard data.count >= 4 else { return nil }; for index in stride(from: data.count - 4, through: 0, by: -1) where data.u32(index) == signature { return index }; return nil }
  private static func invalid(_ message: String) -> LynxDeliveryError { LynxDeliveryError(stage: .archive, code: "ERR_LYNX_ARCHIVE_INVALID", message: message) }
}

private extension Data {
  func u16(_ offset: Int) -> UInt16 {
    let bytes = [UInt8](self[offset..<(offset + 2)])
    return UInt16(bytes[0]) | UInt16(bytes[1]) << 8
  }

  func u32(_ offset: Int) -> UInt32 {
    UInt32(u16(offset)) | UInt32(u16(offset + 2)) << 16
  }
}
