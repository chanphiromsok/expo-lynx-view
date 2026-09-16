Pod::Spec.new do |s|
  s.name = 'Lynx'
  s.version = '4.0.0'
  s.summary = 'Precompiled Lynx iOS framework'
  s.homepage = 'https://github.com/lynx-family/lynx'
  s.author = 'Lynx'
  s.license = { :type => 'Apache-2.0', :file => 'LICENSE' }
  s.source = { :git => 'https://github.com/lynx-family/lynx.git', :tag => '4.0.0' }
  s.platform = :ios, '16.4'
  s.default_subspec = 'Framework'
  s.static_framework = true

  s.subspec 'ReleaseResource' do |resource|
    resource.resource_bundles = { 'LynxResources' => 'lynx_core.js' }
  end

  s.subspec 'Framework' do |framework|
    framework.vendored_frameworks = 'Lynx.xcframework'
    framework.dependency 'Lynx/ReleaseResource'
    framework.dependency 'LynxBase/Framework', '4.0.2'
    framework.dependency 'LynxServiceAPI', '4.0.0'
    framework.dependency 'PrimJS/napi/env', '4.0.0'
    framework.dependency 'PrimJS/napi/jsc', '4.0.0'
    framework.dependency 'PrimJS/napi/quickjs', '4.0.0'
    framework.dependency 'PrimJS/quickjs', '4.0.0'
  end
end
