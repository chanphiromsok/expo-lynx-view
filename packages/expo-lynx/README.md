# expo-lynx

Embed a compiled Lynx page inside an Expo or React Native app on iOS. The module wraps the native `LynxView` from Lynx 4.0 and keeps its exact layout constraints synchronized with the React Native view.

## Install

Add this package to an Expo development build, then regenerate/install the iOS native dependencies:

```json
{
  "expo": {
    "plugins": [
      [
        "expo-lynx",
        {
          "bundledResources": ["./assets/main.lynx", "./assets/static"]
        }
      ]
    ]
  }
}
```

```sh
npx expo prebuild --platform ios
npx expo run:ios
```

This module contains native code and does not work in Expo Go. The iOS deployment target is 16.4 or newer.

The config plugin keeps Lynx's CocoaPods target on its required GNU C++ dialect, applies the Xcode 26 warning compatibility flags, and can copy static Lynx bundles into the iOS application bundle. Run prebuild again after changing the plugin configuration.

## Use

```tsx
import { ExpoLynxView } from 'expo-lynx';

export function LynxScreen() {
  return (
    <ExpoLynxView
      url="https://example.com/main.lynx.bundle"
      initialData={{ greeting: 'Hello from Expo' }}
      onLoad={({ nativeEvent }) => console.log('Loaded', nativeEvent.url)}
      onError={({ nativeEvent }) => console.error(nativeEvent.message)}
      style={{ flex: 1 }}
    />
  );
}
```

`url` accepts an `https://` URL, a `file://` URL, or a resource name copied into the application bundle. For a bundled resource, use either `main.lynx.bundle`, `main.lynx`, or `bundle://main.lynx.bundle`. Add any sidecar asset directories emitted by Rspeedy to `bundledResources` too. Directory structure is preserved, so a template URL such as `/static/image/logo.abc123.png` resolves to `assets/static/image/logo.abc123.png` in release builds.

The view exposes a `reload()` method through its ref:

```tsx
import { useRef } from 'react';
import { ExpoLynxView, type ExpoLynxViewRef } from 'expo-lynx';

const lynxRef = useRef<ExpoLynxViewRef>(null);

await lynxRef.current?.reload();
```

Use HTTPS for remote bundles. Plain HTTP requires an App Transport Security exception in the consuming app.

## Lynx DevTool development

The iOS pod includes Lynx's `Devtool` service. In development, the Expo module's `OnCreate` hook
initializes `LynxEnv`, enables the DevTool/log box switches, and enables all DevTool sessions before
the first `LynxView` is created. Build the app in Debug, start the Lynx DevTool desktop app, and
connect to the running iOS client to inspect the embedded page (DOM/CSS, console, network, and
reload controls).

For HMR, run Rspeedy's development server from the Lynx source project:

```sh
cd /Users/phirom/Desktop/lynx-source
pnpm dev
```

Stop any `serve-bundle.js` process that is already using port `3000`; otherwise Rspeedy may move to
another port while the example still points at the static server. Then select the Dev source in the
example. The URL must point to the Rspeedy server (for example,
`http://192.168.28.196:3000/main.lynx.bundle`), which also serves the `/rsbuild-hmr` WebSocket
endpoint. Do not copy an old `dist/main.lynx.bundle` into a static server: the bundle embeds a
short-lived Rspeedy WebSocket token, so restarting Rspeedy requires loading a freshly generated
bundle from that same server. A static `serve-bundle.js` server can serve the bundle but cannot provide HMR. The final
Debug iOS binary must also include a working `LynxWebSocketModule`; rebuild the native app after
changing the Lynx DevTool pods or Expo config plugin.

If you want component state and the `MemoryRouter` location to survive edits, enable Rspeedy's HMR
and disable full live reload (`hmr: true`, `liveReload: false`). A full `Page.reload` intentionally
creates a new Lynx page, so React state, query-cache state, and in-memory navigation start over.

See the [Lynx DevTool integration guide](https://lynxjs.org/guide/start/integrate-lynx-devtool.html)
for the matching native setup and desktop connection flow.

## Troubleshooting the example

If iOS reports that `NativeMicrotasksCxx` is missing, Metro has bundled a different React Native runtime from the one compiled into the native app. The example's Metro configuration pins React, React Native, and Expo to the example application's dependencies to prevent this when loading the module source from the parent directory.

After changing dependencies or `metro.config.js`, stop the existing Metro process and restart it with an empty cache before reopening the app:

```sh
cd example
pnpm exec expo start --clear
```

The example uses `SafeAreaProvider` and `SafeAreaView` from `react-native-safe-area-context`, as recommended for current Expo and React Native versions.
