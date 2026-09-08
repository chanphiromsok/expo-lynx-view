# LynxExample — bare iOS host

No Expo, no React Native. Embeds `LynxView` directly and registers the
`<x-lynx-fast-image>` element, whose Swift/ObjC is compiled straight from
`../../../packages/expo-lynx/ios/FastImage` (it has no Expo dependency).

## Bootstrap

```sh
xcodegen           # project.yml  -> LynxExample.xcodeproj
pod install        # Podfile      -> LynxExample.xcworkspace + Pods/
open LynxExample.xcworkspace
```

Run `pnpm --filter @expo-lynx/lynx-example dev` for the bundle, then enter
`http://localhost:3000/main.lynx.bundle` in the app and tap Load.
