import Lynx
import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // On Lynx 4.0.0 the DevTool component auto-attaches by reflection when
    // `LynxDevtool` is linked; `enableDevtoolDebug` is the switch. This also
    // brings up the SocketRocket WebSocket that rspeedy Fast Refresh needs.
    let env = LynxEnv.sharedInstance()
    #if DEBUG
      env.enableDevtoolDebug = true
    #endif
    _ = env

    let window = UIWindow(frame: UIScreen.main.bounds)
    // URL entry lives on HomeViewController; tapping "Load" pushes a
    // full-screen LynxPlayerViewController — mirrors Lynx Explorer's flow.
    window.rootViewController = UINavigationController(rootViewController: HomeViewController())
    window.makeKeyAndVisible()
    self.window = window
    return true
  }
}
