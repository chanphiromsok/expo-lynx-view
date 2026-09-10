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
  # Managed delivery uses MMKV for its tiny synchronous boot-state snapshot;
  # it does not share an MMKV instance with React Native. Keep this range on
  # 2.x so the host resolves one compatible MMKVCore for the whole app target.
  s.dependency 'MMKV', '>= 2.4.0', '< 3.0'
  s.dependency 'Lynx/Framework', '4.0.0'
  s.dependency 'PrimJS/quickjs', '4.0.0'
  s.dependency 'PrimJS/napi', '4.0.0'
  s.dependency 'LynxService/Http', '4.0.0'
  # Do not add LynxService/Devtool or LynxService/Log here. CocoaPods applies
  # podspec dependencies to every build configuration, so a "Debug" option
  # would still link DebugRouter into production hosts.

  # Backs the <x-lynx-fast-image> element (ios/FastImage/). Shared range with
  # Expo Image 57.x so the host resolves one SDWebImage for the whole target.
  s.dependency 'SDWebImage', '~> 5.21.0'

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
  s.exclude_files = "tests/**/*"
  s.public_header_files = [
    'ExpoLynx.h',
    'FastImage/LynxFastImageViewProtocol.h',
  ]
  # Swift needs the UIKit-only bridge protocol header in the module interface.
  # The LynxUI implementation header stays private because it imports Lynx.
  s.private_header_files = "FastImage/LynxFastImageElement.h"
end
