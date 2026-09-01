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
  s.dependency 'Lynx/Framework', '4.0.0'
  s.dependency 'PrimJS/quickjs', '4.0.0'
  s.dependency 'PrimJS/napi', '4.0.0'
  s.dependency 'LynxService/Image', '4.0.0'
  s.dependency 'LynxService/Log', '4.0.0'
  s.dependency 'LynxService/Http', '4.0.0'
  s.dependency 'LynxService/Devtool', '4.0.0'
  # Lynx's integration guide lists these explicitly. LynxService/Devtool pulls
  # most of them transitively, but the MessageTransceiverEnable subspec must be
  # present for DevTool Desktop's debug-router connection.

  # s.dependency 'LynxDevtool', '4.0.0'
  # s.dependency 'DebugRouter', '5.0.15'
  # s.dependency 'DebugRouter/MessageTransceiverEnable', '5.0.15'
  s.dependency 'SDWebImage', '5.15.5'
  s.dependency 'SDWebImageWebPCoder', '0.11.0'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
  s.exclude_files = "tests/**/*"
end
