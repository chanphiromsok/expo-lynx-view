Pod::Spec.new do |s|
  s.name           = 'ExpoLynx'
  s.version        = '1.0.0'
  s.summary        = 'Embed Lynx views in Expo and React Native apps'
  s.description    = 'An Expo module that hosts the Lynx iOS rendering engine in a native view.'
  s.author         = 'Rom'
  s.homepage       = 'https://github.com/chanphiromsok/expo-lynx-view'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'MMKV', '>= 2.4.0', '< 3.0'
  s.dependency 'Lynx/Framework', '4.1.0'
  s.dependency 'PrimJS/quickjs', '4.1.1'
  s.dependency 'PrimJS/napi', '4.1.1'
  s.dependency 'LynxService/Http', '4.1.0'
  s.dependency 'XElement', '4.1.0'
  # Do not add LynxService/Devtool, LynxDevtool, or DebugRouter here. CocoaPods
  # applies podspec dependencies to every build configuration, so even a
  # "Debug"-labeled option would still link DebugRouter into Release hosts.
  # DevTool is wired up Debug-only in the consuming app's Podfile instead, via
  # app.plugin.js's addExpoLynxDevtoolPod (see LynxEnv devtool setup in
  # ExpoLynxModule.swift). https://lynxjs.org/guide/start/integrate-lynx-devtool.html?platform=ios
  s.dependency 'SDWebImage'
  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    # Surface actor-isolation violations at the Lynx callback boundary. Lynx
    # delivers two of the three LynxViewLifecycle callbacks on its own threads
    # (see docs/ios-concurrency-lifecycle-remediation.md, F1/F3), which Swift 5
    # mode does not diagnose. `targeted` checks only code that already opts into
    # Sendable/actors; `complete` would bury the signal under noise from the
    # un-annotated Lynx Objective-C surface. Revisit `complete` once the Lynx
    # import can be wrapped with `@preconcurrency`.
    'SWIFT_STRICT_CONCURRENCY' => 'targeted',
  }

  s.module_name = 'ExpoLynx'
  s.header_dir = 'ExpoLynx'
  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
  # Precompiled/ ships Lynx.xcframework's own bundled headers (e.g.
  # LynxPerformanceController.h) alongside this podspec's real sources, at
  # this same podspec's root. The unscoped glob above sweeps them in too,
  # so ExpoLynx's own target ends up compiling a second copy of every Lynx
  # framework header — "duplicate interface definition for class
  # LynxPerformanceController" — regardless of whether the Podfile points
  # `Lynx` at this same xcframework or resolves it from source. Confirmed
  # with a real `xcodebuild`: the duplicate only stopped once Precompiled/**
  # was excluded here.
  s.exclude_files = ["tests/**/*", "Precompiled/**/*"]
  s.public_header_files = [
    'ExpoLynx.h',
    'FastImage/LynxFastImageViewProtocol.h',
  ]
  # Swift needs the UIKit-only bridge protocol header in the module interface.
  # The LynxUI implementation header stays private because it imports Lynx.
  s.private_header_files = "FastImage/LynxFastImageElement.h"
end
