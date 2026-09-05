#if DEBUG || LYNX_IFR_METRICS
  import OSLog

  enum LynxIFRLogger {
    private static let logger = Logger(subsystem: "expo.lynx.view", category: "IFR")

    static func deliveryStorePrepared(_ milliseconds: Int) {
      logger.notice("delivery_store_prepare_ms=\(milliseconds, privacy: .public)")
    }

    static func sourceSelected(_ milliseconds: Int, feature: String, source: String) {
      logger.notice(
        "source_selection_ms=\(milliseconds, privacy: .public) feature=\(feature, privacy: .public) source=\(source, privacy: .public)"
      )
    }

    static func loadFinished(_ milliseconds: Int, feature: String, source: String) {
      logger.notice(
        "load_finished_ms=\(milliseconds, privacy: .public) feature=\(feature, privacy: .public) source=\(source, privacy: .public)"
      )
    }

    static func firstScreen(_ milliseconds: Int, feature: String, source: String) {
      logger.notice(
        "first_screen_ms=\(milliseconds, privacy: .public) feature=\(feature, privacy: .public) source=\(source, privacy: .public)"
      )
    }

    static func deliveryStarted(_ milliseconds: Int, feature: String) {
      logger.notice(
        "delivery_start_ms=\(milliseconds, privacy: .public) feature=\(feature, privacy: .public)"
      )
    }
  }
#endif
