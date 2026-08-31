import Foundation

@main
enum LynxSignatureVerifierFixtureTest {
  static func main() throws {
    let arguments = CommandLine.arguments
    guard arguments.count == 4 else {
      fatalError("Usage: LynxSignatureVerifierFixtureTest <public-key> <deployment-envelope> <release-envelope>")
    }

    let publicKey = try Data(contentsOf: URL(fileURLWithPath: arguments[1]))
    let deploymentEnvelope = try Data(contentsOf: URL(fileURLWithPath: arguments[2]))
    let releaseEnvelope = try Data(contentsOf: URL(fileURLWithPath: arguments[3]))

    let deploymentPayload = try LynxSignatureVerifier.verify(
      envelopeData: deploymentEnvelope,
      expectedType: "lynx-deployment",
      expectedFeature: "shopping",
      publicKeyPEM: publicKey
    )
    let deployment = try LynxDeploymentPayload.decodeVerified(
      deploymentPayload,
      expectedFeature: "shopping"
    )
    let releasePayload = try LynxSignatureVerifier.verify(
      envelopeData: releaseEnvelope,
      expectedType: "lynx-release",
      expectedFeature: "shopping",
      publicKeyPEM: publicKey
    )
    guard deployment.releaseId == "shopping-2026.08.29.1", !releasePayload.isEmpty else {
      fatalError("Expected non-empty signed payloads")
    }

    expect(.wrongDocumentType) {
      _ = try LynxSignatureVerifier.verify(
        envelopeData: deploymentEnvelope,
        expectedType: "lynx-release",
        expectedFeature: "shopping",
        publicKeyPEM: publicKey
      )
    }
    expect(.featureMismatch) {
      _ = try LynxSignatureVerifier.verify(
        envelopeData: releaseEnvelope,
        expectedType: "lynx-release",
        expectedFeature: "orders",
        publicKeyPEM: publicKey
      )
    }
    expect(.invalidSignature) {
      _ = try LynxSignatureVerifier.verify(
        envelopeData: tamperedSignature(deploymentEnvelope),
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

  private static func tamperedSignature(_ envelope: Data) -> Data {
    var object = try! JSONSerialization.jsonObject(with: envelope) as! [String: Any]
    let signature = object["signature"] as! String
    object["signature"] = (signature.first == "A" ? "B" : "A") + signature.dropFirst()
    return try! JSONSerialization.data(withJSONObject: object)
  }
}
