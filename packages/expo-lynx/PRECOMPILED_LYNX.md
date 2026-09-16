# Rebuild the iOS Lynx XCFramework

Run the script from this package against an Expo app whose iOS Pods contain **source** Lynx. It builds the `Lynx` CocoaPods target for device arm64 and simulator arm64/x86_64, strips debug symbols, and replaces `ios/Precompiled/Lynx.xcframework`, `Lynx.podspec`, the release JS resource, and the upstream license. The old output stays in place if a build or validation fails.

```bash
./precompile-lynx-ios.sh --check /path/to/app/ios
./precompile-lynx-ios.sh /path/to/app/ios
```

The script needs Xcode, CocoaPods, the app's `.xcworkspace` and `Podfile.lock`, and `Pods/Lynx` installed from source. It reads the resolved versions from `Podfile.lock`. It pins the generated binary podspec to the exact LynxBase, LynxServiceAPI, and PrimJS versions used during compilation. To reuse existing build products, set `LYNX_DERIVED_DATA` to an absolute path; otherwise the script creates and cleans up temporary DerivedData. Allow roughly 30 GB of free disk space for a clean build.

## Changing Lynx or PrimJS

1. Edit the four version pins in [ExpoLynx.podspec](ios/ExpoLynx.podspec): `Lynx/Framework`, `LynxService/Http`, `PrimJS/quickjs`, and `PrimJS/napi`. If only LynxBase or LynxServiceAPI changes, the script still rebuilds and repins the binary from the app lockfile.
2. Install or link the edited module into the build app so its `node_modules/expo-lynx-view/ios/ExpoLynx.podspec` has those pins. In the app's Podfile, temporarily remove the plugin-generated local `pod 'Lynx', :path => .../Precompiled` line. Resolve the desired **source** pods with `pod update Lynx` and/or `pod update PrimJS` from the app's `ios` directory. Update LynxBase or LynxService pods too if their versions need to change. Check `Podfile.lock`; do not edit it by hand. CocoaPods will reject a PrimJS version that the chosen Lynx podspec does not allow. See [CocoaPods' install/update guide](https://guides.cocoapods.org/using/pod-install-vs-update.html).
3. Run `./precompile-lynx-ios.sh /path/to/app/ios`. The script stops if `ExpoLynx.podspec` and the resolved lockfile disagree. Run `--check` afterward to confirm the generated podspec matches the lockfile.
4. Reinstall this module in the consuming app, regenerate the Podfile with the Expo plugin, and run `pod install`. Build the app once to verify the new binary links. Commit the changed podspec and XCFramework together.

Changing **PrimJS alone still requires a new Lynx binary**, because the Lynx target is compiled against PrimJS headers and symbols. This package precompiles the Lynx iOS target; PrimJS, LynxBase, and LynxService remain source pods. Apple documents the two-platform [XCFramework packaging step](https://developer.apple.com/documentation/Xcode/creating-a-multi-platform-binary-framework-bundle).
