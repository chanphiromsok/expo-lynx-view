import ExpoModulesCore
import Lynx

public final class ExpoLynxModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoLynx")

    AsyncFunction("checkForUpdate") { (feature: String) async throws -> [String: Any] in
      return try await LynxManagedDeliveryCoordinator.shared
        .checkForUpdate(feature: feature)
        .modulePayload()
    }

    OnCreate {
#if !DEBUG
      // Lynx defaults to emitting native Info logs through NSLog in Release.
      // Raise its one-way threshold before environment initialization so it
      // also suppresses normal Lynx startup output while retaining errors/fatals.
      SetMinimumLoggingLevel(.error)
#endif

      // Lynx requires the shared environment to exist before any other Lynx API is used.
      let lynxEnv = LynxEnv.sharedInstance()

      // Match Lynx Explorer's setupEnvironment: prepare one global config
      // before constructing any LynxView. The view creates a per-view config
      // from this provider and installs it as both the template and generic
      // resource fetcher so Rspeedy can fetch HMR hot-update resources.
      lynxEnv.prepareConfig(LynxConfig(provider: ExpoLynxTemplateProvider.shared))
    }

    View(ExpoLynxView.self) {
      Events("onLoadStart", "onLoad", "onError", "onUpdate")

      Prop("url") { (view: ExpoLynxView, url: String?) in
        view.setSource(url)
      }

      Prop("sourceJSON") { (view: ExpoLynxView, sourceJSON: String?) in
        view.setSourceJSON(sourceJSON)
      }

      Prop("initialDataJSON") { (view: ExpoLynxView, initialDataJSON: String?) in
        view.setInitialDataJSON(initialDataJSON)
      }

      // ponytail: OnViewDidUpdateProps fires once per React update batch, after all
      // Props have been set. Without this, Expo Modules Core may apply url before
      // initialDataJSON (or vice versa) and the in-flight load reads a stale field.
      OnViewDidUpdateProps { (view: ExpoLynxView) in
        view.applyPendingUpdate()
      }

      AsyncFunction("reload") { (view: ExpoLynxView) in
        view.reload()
      }

    }
  }
}
