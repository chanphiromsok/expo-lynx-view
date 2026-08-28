import ExpoModulesCore
import Lynx

public final class ExpoLynxModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoLynx")

    OnCreate {
#if !DEBUG
      // Lynx defaults to emitting native Info logs through NSLog in Release.
      // Raise its one-way threshold before environment initialization so it
      // also suppresses normal Lynx startup output while retaining errors/fatals.
      SetMinimumLoggingLevel(.error)
#endif

      // Lynx requires the shared environment to exist before any other Lynx API is used.
      let lynxEnv = LynxEnv.sharedInstance()

#if DEBUG
      // LynxService/Devtool registers LynxDevToolService at load time. Set its
      // presets immediately after LynxEnv initialization, then enable the
      // environment and all sessions for subsequently-created LynxViews.
      let devToolService = LynxServices.getInstanceWith(LynxServiceDevToolProtocol.self)
        as? LynxServiceDevToolProtocol
      devToolService?.lynxDebugPresetValue = true
      devToolService?.logBoxPresetValue = true
      devToolService?.enableAllSessions()

      // Lynx DevTool is disabled by default in embedded hosts. These switches
      // must be set after LynxEnv initialization and before creating a LynxView.
      // Keep this in the native module's OnCreate hook so every view created by
      // ExpoLynx is inspectable from the Lynx DevTool desktop app.
      lynxEnv.lynxDebugEnabled = true
      lynxEnv.devtoolEnabled = true
      lynxEnv.logBoxEnabled = true

      let devToolSettings = DevToolSettings.sharedInstance()
      devToolSettings.devToolEnabled = true
      devToolSettings.logBoxEnabled = true
#endif

      // Match Lynx Explorer's setupEnvironment: prepare one global config
      // before constructing any LynxView. The view creates a per-view config
      // from this provider and installs it as both the template and generic
      // resource fetcher so Rspeedy can fetch HMR hot-update resources.
      lynxEnv.prepareConfig(LynxConfig(provider: ExpoLynxTemplateProvider.shared))
    }

    View(ExpoLynxView.self) {
      Events("onLoadStart", "onLoad", "onError")

      Prop("url") { (view: ExpoLynxView, url: String) in
        view.setSource(url)
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
