#!/usr/bin/env bash
set -euo pipefail

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

check_only=0
if [[ "${1:-}" == '--check' ]]; then check_only=1; shift; fi
[[ $# -eq 1 ]] || die "usage: $0 [--check] /path/to/app/ios"
app_ios_dir="$(cd "$1" && pwd -P)"
package_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
module_podspec="$package_dir/ios/ExpoLynx.podspec"
output_dir="$package_dir/ios/Precompiled"
lockfile="$app_ios_dir/Podfile.lock"
[[ -f "$lockfile" ]] || die "missing $lockfile; run pod install in the app first"

version_for() {
  awk -v prefix="  - $1 (" 'index($0, prefix) == 1 {
    version = substr($0, length(prefix) + 1)
    sub(/\).*/, "", version)
    print version
    exit
  }' "$lockfile"
}

locked_version() {
  local version
  version="$(version_for "$1")"
  [[ "$version" =~ ^[0-9]+[.][0-9]+[.][0-9]+([-.][[:alnum:].]+)?$ ]] ||
    die "missing or invalid $1 version in $lockfile"
  printf '%s' "$version"
}

require_pin() {
  grep -Fq "s.dependency '$1', '$2'" "$module_podspec" ||
    die "set $1 to $2 in $module_podspec, then update the app Pods"
}

lynx_version="$(locked_version 'Lynx/Framework')"
base_version="$(locked_version 'LynxBase/Framework')"
service_version="$(locked_version 'LynxService/Http')"
api_version="$(locked_version 'LynxServiceAPI')"
primjs_version="$(locked_version 'PrimJS/quickjs')"
for subspec in PrimJS/napi PrimJS/napi/env PrimJS/napi/jsc PrimJS/napi/quickjs; do
  [[ "$(locked_version "$subspec")" == "$primjs_version" ]] ||
    die "$subspec does not match PrimJS/quickjs $primjs_version"
done
require_pin 'Lynx/Framework' "$lynx_version"
require_pin 'LynxService/Http' "$service_version"
require_pin 'PrimJS/quickjs' "$primjs_version"
require_pin 'PrimJS/napi' "$primjs_version"

ios_minimum="$(awk -F "'" '/s.platforms/ { print $2; exit }' "$module_podspec")"
[[ "$ios_minimum" =~ ^[0-9]+[.][0-9]+$ ]] || die "invalid iOS minimum in $module_podspec"
printf 'Lynx %s; LynxBase %s; LynxService %s; LynxServiceAPI %s; PrimJS %s; iOS %s\n' \
  "$lynx_version" "$base_version" "$service_version" "$api_version" "$primjs_version" "$ios_minimum"

if (( check_only )); then
  spec="$output_dir/Lynx.podspec"
  [[ -f "$spec" ]] || die "missing $spec; build the XCFramework"
  grep -Fq "s.version = '$lynx_version'" "$spec" || die "precompiled Lynx is stale; rebuild it"
  for pin in "LynxBase/Framework:$base_version" "LynxServiceAPI:$api_version" \
    "PrimJS/napi/env:$primjs_version" "PrimJS/napi/jsc:$primjs_version" \
    "PrimJS/napi/quickjs:$primjs_version" "PrimJS/quickjs:$primjs_version"; do
    grep -Fq "framework.dependency '${pin%%:*}', '${pin#*:}'" "$spec" ||
      die "precompiled ${pin%%:*} is stale; rebuild it"
  done
  [[ -d "$output_dir/Lynx.xcframework" ]] || die "missing Lynx.xcframework; rebuild it"
  printf 'Precompiled podspec matches Podfile.lock.\n'
  exit 0
fi

[[ -d "$app_ios_dir/Pods/Lynx/core" && -f "$app_ios_dir/Pods/Lynx/LICENSE" && \
   -f "$app_ios_dir/Pods/Lynx/platform/darwin/ios/JSAssets/release/lynx_core.js" ]] ||
  die "install source Lynx Pods in the app before building (see PRECOMPILED_LYNX.md)"
shopt -s nullglob
workspaces=("$app_ios_dir"/*.xcworkspace)
[[ ${#workspaces[@]} -eq 1 ]] || die "expected one .xcworkspace in $app_ios_dir"
workspace="${workspaces[0]}"
for tool in xcodebuild rsync strip pod lipo; do
  command -v "$tool" >/dev/null || die "missing $tool"
done

scratch="$(mktemp -d "${TMPDIR:-/private/tmp}/expo-lynx-precompile.XXXXXX")"
stage="$scratch/output"
previous="$scratch/previous"
derived="${LYNX_DERIVED_DATA:-$scratch/DerivedData}"
[[ "$derived" == /* ]] || die "LYNX_DERIVED_DATA must be an absolute path"
cleanup() {
  local status=$?
  if (( status != 0 )) && [[ -d "$previous" ]]; then
    rm -rf "$output_dir"
    mv "$previous" "$output_dir"
  fi
  rm -rf "$scratch"
  return "$status"
}
trap cleanup EXIT

build_slice() {
  local sdk="$1" destination="$2" architectures="$3"
  printf 'Building %s (%s)...\n' "$sdk" "$architectures"
  if ! xcodebuild -workspace "$workspace" -scheme Lynx -configuration Release \
    -sdk "$sdk" -destination "$destination" -derivedDataPath "$derived" \
    "ARCHS=$architectures" "IPHONEOS_DEPLOYMENT_TARGET=$ios_minimum" \
    CODE_SIGNING_ALLOWED=NO -quiet build > "$scratch/$sdk.log" 2>&1; then
    tail -n 40 "$scratch/$sdk.log" >&2
    die "$sdk build failed"
  fi
}
build_slice iphoneos 'generic/platform=iOS' arm64
build_slice iphonesimulator 'generic/platform=iOS Simulator' 'arm64 x86_64'

for sdk in iphoneos iphonesimulator; do
  product="$derived/Build/Products/Release-$sdk/Lynx/Lynx.framework"
  [[ -f "$product/Lynx" ]] || die "missing $product/Lynx"
  destination="$scratch/$sdk/Lynx.framework"
  mkdir -p "$destination"
  rsync -a --exclude '/Lynx' "$product/" "$destination/"
  strip -S -o "$destination/Lynx" "$product/Lynx"
done
lipo -info "$scratch/iphoneos/Lynx.framework/Lynx" | grep -Fq arm64 || die 'missing device arm64'
sim_info="$(lipo -info "$scratch/iphonesimulator/Lynx.framework/Lynx")"
[[ "$sim_info" == *arm64* && "$sim_info" == *x86_64* ]] || die 'missing simulator architecture'

mkdir -p "$stage"
xcodebuild -create-xcframework \
  -framework "$scratch/iphoneos/Lynx.framework" \
  -framework "$scratch/iphonesimulator/Lynx.framework" \
  -output "$stage/Lynx.xcframework" > "$scratch/xcframework.log" 2>&1 || {
    cat "$scratch/xcframework.log" >&2
    die 'XCFramework creation failed'
  }
cp "$app_ios_dir/Pods/Lynx/LICENSE" "$stage/LICENSE"
cp "$app_ios_dir/Pods/Lynx/platform/darwin/ios/JSAssets/release/lynx_core.js" "$stage/lynx_core.js"
[[ ! -f "$output_dir/README.md" ]] || cp "$output_dir/README.md" "$stage/README.md"
cat > "$stage/Lynx.podspec" <<PODSPEC
Pod::Spec.new do |s|
  s.name = 'Lynx'
  s.version = '$lynx_version'
  s.summary = 'Precompiled Lynx iOS framework'
  s.homepage = 'https://github.com/lynx-family/lynx'
  s.author = 'Lynx'
  s.license = { :type => 'Apache-2.0', :file => 'LICENSE' }
  s.source = { :git => 'https://github.com/lynx-family/lynx.git', :tag => '$lynx_version' }
  s.platform = :ios, '$ios_minimum'
  s.default_subspec = 'Framework'
  s.static_framework = true

  s.subspec 'ReleaseResource' do |resource|
    resource.resource_bundles = { 'LynxResources' => 'lynx_core.js' }
  end

  s.subspec 'Framework' do |framework|
    framework.vendored_frameworks = 'Lynx.xcframework'
    framework.dependency 'Lynx/ReleaseResource'
    framework.dependency 'LynxBase/Framework', '$base_version'
    framework.dependency 'LynxServiceAPI', '$api_version'
    framework.dependency 'PrimJS/napi/env', '$primjs_version'
    framework.dependency 'PrimJS/napi/jsc', '$primjs_version'
    framework.dependency 'PrimJS/napi/quickjs', '$primjs_version'
    framework.dependency 'PrimJS/quickjs', '$primjs_version'
  end
end
PODSPEC
if ! (cd "$app_ios_dir" && pod spec lint "$stage/Lynx.podspec" --quick --allow-warnings \
  > "$scratch/lint.log" 2>&1); then
  tail -n 40 "$scratch/lint.log" >&2
  die 'generated Lynx podspec failed validation'
fi

mv "$output_dir" "$previous"
mv "$stage" "$output_dir" || die 'could not replace the precompiled output'
printf 'Wrote %s/Lynx.xcframework and version-locked Lynx.podspec\n' "$output_dir"
