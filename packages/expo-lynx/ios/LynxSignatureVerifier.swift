import Foundation
import Security

/// The only V2 remote-code trust boundary. Callers must pass the response bytes
/// unchanged: the RSA signature covers those bytes, not a re-encoded JSON value.
enum LynxSignatureVerifier {
  enum VerificationError: Error, LocalizedError, Equatable {
    case missingEmbeddedPublicKey
    case invalidEmbeddedPublicKey
    case malformedEnvelope
    case unsupportedEnvelope
    case invalidBase64URL
    case invalidSignature
    case invalidPayload
    case wrongDocumentType
    case featureMismatch

    var code: String {
      switch self {
      case .missingEmbeddedPublicKey: return "ERR_LYNX_TRUST_KEY_MISSING"
      case .invalidEmbeddedPublicKey: return "ERR_LYNX_TRUST_KEY_INVALID"
      case .malformedEnvelope: return "ERR_LYNX_ENVELOPE_INVALID"
      case .unsupportedEnvelope: return "ERR_LYNX_ENVELOPE_UNSUPPORTED"
      case .invalidBase64URL: return "ERR_LYNX_ENVELOPE_BASE64"
      case .invalidSignature: return "ERR_LYNX_SIGNATURE_INVALID"
      case .invalidPayload: return "ERR_LYNX_SIGNED_PAYLOAD_INVALID"
      case .wrongDocumentType: return "ERR_LYNX_SIGNED_PAYLOAD_TYPE"
      case .featureMismatch: return "ERR_LYNX_SIGNED_PAYLOAD_FEATURE"
      }
    }

    var errorDescription: String? { code }
  }

  private struct Envelope: Decodable {
    let schemaVersion: Int
    let algorithm: String
    let payload: String
    let signature: String
  }

  static func verifyEmbedded(
    envelopeData: Data,
    expectedType: String,
    expectedFeature: String
  ) throws -> Data {
    try verify(
      envelopeData: envelopeData,
      expectedType: expectedType,
      expectedFeature: expectedFeature,
      publicKeyPEM: try embeddedPublicKeyPEM()
    )
  }

  static func verify(
    envelopeData: Data,
    expectedType: String,
    expectedFeature: String,
    publicKeyPEM: Data
  ) throws -> Data {
    let envelope: Envelope
    do {
      envelope = try JSONDecoder().decode(Envelope.self, from: envelopeData)
    } catch {
      throw VerificationError.malformedEnvelope
    }
    guard envelope.schemaVersion == 1, envelope.algorithm == "RSA-SHA256" else {
      throw VerificationError.unsupportedEnvelope
    }
    let payload = try decodeBase64URL(envelope.payload)
    let signature = try decodeBase64URL(envelope.signature)
    let publicKey = try makePublicKey(from: publicKeyPEM)
    var verificationError: Unmanaged<CFError>?
    guard SecKeyVerifySignature(
      publicKey,
      .rsaSignatureMessagePKCS1v15SHA256,
      payload as CFData,
      signature as CFData,
      &verificationError
    ) else {
      throw VerificationError.invalidSignature
    }

    let signedDocument: [String: Any]
    do {
      guard let object = try JSONSerialization.jsonObject(with: payload) as? [String: Any] else {
        throw VerificationError.invalidPayload
      }
      signedDocument = object
    } catch let error as VerificationError {
      throw error
    } catch {
      throw VerificationError.invalidPayload
    }
    guard signedDocument["type"] as? String == expectedType else {
      throw VerificationError.wrongDocumentType
    }
    guard signedDocument["feature"] as? String == expectedFeature else {
      throw VerificationError.featureMismatch
    }
    return payload
  }

  static func embeddedPublicKeyPEM(bundle: Bundle = .main) throws -> Data {
    guard let resourceRoot = bundle.resourceURL else {
      throw VerificationError.missingEmbeddedPublicKey
    }
    let url = resourceRoot
      .appendingPathComponent("ExpoLynxEmbedded.bundle", isDirectory: true)
      .appendingPathComponent("updates.public.pem", isDirectory: false)
    guard let data = try? Data(contentsOf: url), !data.isEmpty else {
      throw VerificationError.missingEmbeddedPublicKey
    }
    return data
  }

  private static func decodeBase64URL(_ value: String) throws -> Data {
    guard !value.isEmpty,
      !value.contains("="),
      value.utf8.allSatisfy({ byte in
        (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122) ||
          (byte >= 48 && byte <= 57) || byte == 45 || byte == 95
      }),
      value.utf8.count % 4 != 1
    else {
      throw VerificationError.invalidBase64URL
    }
    let base64 = value.replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
      + String(repeating: "=", count: (4 - value.utf8.count % 4) % 4)
    guard let data = Data(base64Encoded: base64),
      data.base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "") == value
    else {
      throw VerificationError.invalidBase64URL
    }
    return data
  }

  private static func makePublicKey(from pemData: Data) throws -> SecKey {
    guard let pem = String(data: pemData, encoding: .utf8) else {
      throw VerificationError.invalidEmbeddedPublicKey
    }
    let normalized = pem.replacingOccurrences(of: "\r\n", with: "\n")
      .replacingOccurrences(of: "\r", with: "\n")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let begin = "-----BEGIN PUBLIC KEY-----"
    let end = "-----END PUBLIC KEY-----"
    guard normalized.hasPrefix(begin), normalized.hasSuffix(end),
      normalized.components(separatedBy: "-----BEGIN ").count == 2,
      normalized.components(separatedBy: "-----END ").count == 2,
      !normalized.contains("PRIVATE KEY"), !normalized.contains("CERTIFICATE")
    else {
      throw VerificationError.invalidEmbeddedPublicKey
    }
    let body = normalized
      .dropFirst(begin.count)
      .dropLast(end.count)
      .filter { !$0.isWhitespace }
    guard !body.isEmpty,
      body.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "+" || $0 == "/" || $0 == "=") }),
      let der = Data(base64Encoded: String(body))
    else {
      throw VerificationError.invalidEmbeddedPublicKey
    }
    try validateRSA3072SPKI(der)
    let attributes: [CFString: Any] = [
      kSecAttrKeyType: kSecAttrKeyTypeRSA,
      kSecAttrKeyClass: kSecAttrKeyClassPublic,
    ]
    var error: Unmanaged<CFError>?
    guard let key = SecKeyCreateWithData(der as CFData, attributes as CFDictionary, &error) else {
      throw VerificationError.invalidEmbeddedPublicKey
    }
    return key
  }

  private static func validateRSA3072SPKI(_ der: Data) throws {
    var root = DERReader(der)
    var outer = DERReader(try root.read(tag: 0x30))
    guard root.isAtEnd else { throw VerificationError.invalidEmbeddedPublicKey }

    var algorithm = DERReader(try outer.read(tag: 0x30))
    guard try algorithm.read(tag: 0x06) == Data([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]) else {
      throw VerificationError.invalidEmbeddedPublicKey
    }
    if !algorithm.isAtEnd {
      guard try algorithm.read(tag: 0x05).isEmpty, algorithm.isAtEnd else {
        throw VerificationError.invalidEmbeddedPublicKey
      }
    }
    let bitString = try outer.read(tag: 0x03)
    guard outer.isAtEnd, bitString.first == 0 else { throw VerificationError.invalidEmbeddedPublicKey }

    var bitStringReader = DERReader(Data(bitString.dropFirst()))
    var rsa = DERReader(try bitStringReader.read(tag: 0x30))
    guard bitStringReader.isAtEnd else { throw VerificationError.invalidEmbeddedPublicKey }
    let modulus = try positiveInteger(from: rsa.read(tag: 0x02))
    let exponent = try positiveInteger(from: rsa.read(tag: 0x02))
    guard rsa.isAtEnd, bitLength(modulus) >= 3072, integerValue(exponent) == 65537 else {
      throw VerificationError.invalidEmbeddedPublicKey
    }
  }

  private static func positiveInteger(from value: Data) throws -> Data {
    guard !value.isEmpty else { throw VerificationError.invalidEmbeddedPublicKey }
    if value.count == 1 { return value }
    if value[0] == 0 {
      guard value[1] & 0x80 != 0 else { throw VerificationError.invalidEmbeddedPublicKey }
      return Data(value.dropFirst())
    }
    guard value[0] & 0x80 == 0 else { throw VerificationError.invalidEmbeddedPublicKey }
    return value
  }

  private static func bitLength(_ value: Data) -> Int {
    guard let first = value.first else { return 0 }
    var leadingZeroes = 0
    var mask: UInt8 = 0x80
    while first & mask == 0 {
      leadingZeroes += 1
      mask >>= 1
    }
    return value.count * 8 - leadingZeroes
  }

  private static func integerValue(_ value: Data) -> Int? {
    guard value.count <= MemoryLayout<Int>.size else { return nil }
    return value.reduce(0) { partial, byte in partial << 8 | Int(byte) }
  }
}

private struct DERReader {
  private let bytes: [UInt8]
  private var index = 0

  init(_ data: Data) { bytes = Array(data) }
  var isAtEnd: Bool { index == bytes.count }

  mutating func read(tag: UInt8) throws -> Data {
    guard index < bytes.count, bytes[index] == tag else { throw LynxSignatureVerifier.VerificationError.invalidEmbeddedPublicKey }
    index += 1
    guard index < bytes.count else { throw LynxSignatureVerifier.VerificationError.invalidEmbeddedPublicKey }
    let firstLengthByte = bytes[index]
    index += 1
    let length: Int
    if firstLengthByte & 0x80 == 0 {
      length = Int(firstLengthByte)
    } else {
      let count = Int(firstLengthByte & 0x7f)
      guard count > 0, count <= 4, index + count <= bytes.count, bytes[index] != 0 else {
        throw LynxSignatureVerifier.VerificationError.invalidEmbeddedPublicKey
      }
      var result = 0
      for _ in 0..<count {
        result = result << 8 | Int(bytes[index])
        index += 1
      }
      guard result >= 128 else { throw LynxSignatureVerifier.VerificationError.invalidEmbeddedPublicKey }
      length = result
    }
    guard length >= 0, index + length <= bytes.count else { throw LynxSignatureVerifier.VerificationError.invalidEmbeddedPublicKey }
    let result = Data(bytes[index..<(index + length)])
    index += length
    return result
  }
}
