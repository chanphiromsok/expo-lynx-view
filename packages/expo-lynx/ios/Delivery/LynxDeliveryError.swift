import Foundation

enum LynxDeliveryStage: String {
  case manifest
  case signature
  case compatibility
  case download
  case checksum
  case resource
  case archive
  case lynx
}

struct LynxDeliveryError: LocalizedError {
  let stage: LynxDeliveryStage
  let code: String
  let message: String

  var errorDescription: String? { message }
}
