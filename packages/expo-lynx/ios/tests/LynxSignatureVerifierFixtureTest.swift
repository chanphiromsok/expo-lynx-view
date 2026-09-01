import Foundation

@main
enum LynxSignatureVerifierFixtureTest {
  static func main() throws {
    let arguments = CommandLine.arguments
    guard arguments.count == 3 else {
      fatalError("Usage: LynxSignatureVerifierFixtureTest <public-key> <signed-deployment-fixture>")
    }

    let publicKey = try Data(contentsOf: URL(fileURLWithPath: arguments[1]))
    let legacyFixture = try Data(contentsOf: URL(fileURLWithPath: arguments[2]))
    let detached = try detachedDocument(from: legacyFixture)

    let verified = try LynxSignatureVerifier.verifyDetached(
      documentData: detached.document,
      signature: detached.signature,
      expectedType: "lynx-deployment",
      expectedFeature: "shopping",
      publicKeyPEM: publicKey
    )
    guard verified == detached.document else {
      fatalError("Expected detached document bytes to round-trip unchanged")
    }

    let deployment = try LynxDeploymentPayload.decodeVerified(
      Data(
        #"{"schemaVersion":1,"type":"lynx-deployment","feature":"shopping","revision":7,"enabled":true,"force":false,"releaseId":"shopping-2026.09.01.1","version":"2026.09.01","runtimeVersion":"expo-57","archiveUrl":"/v1/bundles/shopping/shopping-2026.09.01.1/release.zip","archiveSha256":"1111111111111111111111111111111111111111111111111111111111111111","archiveBytes":32,"issuedAt":"2026-09-01T01:20:00.000Z"}"#.utf8
      ),
      expectedFeature: "shopping"
    )
    guard deployment.releaseId == "shopping-2026.09.01.1", deployment.archiveBytes == 32 else {
      fatalError("Expected a valid direct-archive deployment")
    }

    expect(.wrongDocumentType) {
      _ = try LynxSignatureVerifier.verifyDetached(
        documentData: detached.document,
        signature: detached.signature,
        expectedType: "lynx-release",
        expectedFeature: "shopping",
        publicKeyPEM: publicKey
      )
    }
    expect(.featureMismatch) {
      _ = try LynxSignatureVerifier.verifyDetached(
        documentData: detached.document,
        signature: detached.signature,
        expectedType: "lynx-deployment",
        expectedFeature: "orders",
        publicKeyPEM: publicKey
      )
    }
    expect(.invalidSignature) {
      _ = try LynxSignatureVerifier.verifyDetached(
        documentData: detached.document,
        signature: tamperedSignature(detached.signature),
        expectedType: "lynx-deployment",
        expectedFeature: "shopping",
        publicKeyPEM: publicKey
      )
    }
    expect(.missingSignature) {
      _ = try LynxSignatureVerifier.verifyDetached(
        documentData: detached.document,
        signature: nil,
        expectedType: "lynx-deployment",
        expectedFeature: "shopping",
        publicKeyPEM: publicKey
      )
    }
  }

  private static func expect(
    _ expected: LynxSignatureVerifier.VerificationError,
    operation: () throws -> Void
  ) {
    do {
      try operation()
      fatalError("Expected \(expected.code)")
    } catch let error as LynxSignatureVerifier.VerificationError {
      guard error == expected else {
        fatalError("Expected \(expected.code), received \(error.code)")
      }
    } catch {
      fatalError("Expected \(expected.code), received \(error)")
    }
  }

  private static func detachedDocument(from envelope: Data) throws -> (document: Data, signature: String) {
    guard let object = try JSONSerialization.jsonObject(with: envelope) as? [String: Any],
      let payload = object["payload"] as? String,
      let signature = object["signature"] as? String
    else {
      fatalError("The legacy fixture is malformed")
    }
    let base64 = payload.replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
      + String(repeating: "=", count: (4 - payload.utf8.count % 4) % 4)
    guard let document = Data(base64Encoded: base64) else {
      fatalError("The legacy fixture payload is not base64url")
    }
    return (document, signature)
  }

  private static func tamperedSignature(_ signature: String) -> String {
    (signature.first == "A" ? "B" : "A") + signature.dropFirst()
  }
}
