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
      source={{ kind: 'embedded', feature: 'delivery' }}
      initialData={{ greeting: 'Hello from Expo' }}
      onLoad={({ nativeEvent }) => console.log('Loaded', nativeEvent.url)}
      onError={({ nativeEvent }) => console.error(nativeEvent.message)}
      style={{ flex: 1 }}
    />
  );
}
```

`source` has three iOS modes: `embedded`, `development`, and `managed`.
`development` accepts a raw URL only in Debug builds. A `managed` source loads a
feature's embedded baseline or confirmed cache immediately, then revalidates its
signed channel in the background. A new signed ZIP is fully verified during
installation and staged for the next mini-app open; it never replaces a mounted
view. The legacy `url` prop remains available for compatibility, but Release
iOS builds reject raw remote URLs.

For a bundled resource, add the `.lynx` bundle and every Rspeedy sidecar directory to `bundledResources`. Directory structure is preserved, so a template reference such as `static/image/logo.abc123.png` resolves in both the embedded baseline and a managed release.

### Feature-name autocomplete for V2 embedded bundles

When V2 `embeddedBundlesPath` is configured, Expo prebuild validates its
`registry.json` and writes a sibling declaration file at
`generated/expo-lynx/lynx-features.d.ts`. The file augments `expo-lynx` with
the exact canonical feature IDs. After prebuild, editors autocomplete those IDs
and TypeScript rejects an unknown `source.feature` value:

```tsx
const source: LynxSource = {
  kind: 'managed',
  feature: 'shopping', // autocomplete comes from the embedded registry
  channel: 'stable',
};
```

The declaration is generated from local, already-validated embedded resources;
it never reads a remote release or channel response. Keep the generated path in
your app TypeScript project (the standard Expo `tsconfig` includes it). Before a
first prebuild, `LynxFeatureName` intentionally falls back to `string` so
library consumers are not blocked.

## Local managed-bundle test on iOS

For the end-to-end iOS architecture, callback expectations, Release opt-in,
failure matrix, and R2 transition, see
[`feature/delivery-bundle-update/DEVELOPMENT.md`](./feature/delivery-bundle-update/DEVELOPMENT.md).

The repository includes a zero-dependency static server that copies the example's embedded artifact, enumerates its sidecars, and generates a matching manifest:

```sh
pnpm serve:lynx-local
pnpm ios
```

The example starts in `Managed cache` mode and requests the host configured by `expo.extra.lynxDevBundleHost`. Use `127.0.0.1` for a simulator-only workflow. For a physical iPhone, use one of the LAN addresses printed by the server, then rebuild the development app; that LAN address also works from the simulator.

To serve the latest artifact built by the sibling `/Users/phirom/Desktop/lynx-source` project without replacing the embedded baseline, run:

```sh
cd /Users/phirom/Desktop/lynx-source
npm run build

cd /Users/phirom/Desktop/expo-lynx-monorepo
pnpm serve:lynx-remote
```

This keeps `assets/static.lynx` unchanged, so the first physical-device test visibly exercises the managed `embedded → download` transition instead of serving the same bytes as both sources.

After changing the Lynx source, use the rebuild helper:

```sh
pnpm rebuild:lynx-remote
```

It runs `npm run build` in `/Users/phirom/Desktop/lynx-source`, refreshes the ignored `.local-lynx-server/` files, and leaves an already-running `pnpm serve:lynx-remote` process serving the new bundle. Reload or reopen the managed mini-app to fetch the new manifest. Set `LYNX_SOURCE_DIR` when the Lynx source lives elsewhere.

For signed V2 delivery, use the printed channel route as `channelUrl`. The
native view first renders the current cache or embedded baseline, then sends a
small ETag revalidation request. A `304` or an unchanged release ID does not
download a ZIP, extract files, or rehash cached content. Only a signed channel
pointer to a new release downloads and installs the ZIP; that release activates
on the next mini-app open.

```tsx
const source: LynxSource = {
  kind: 'managed',
  feature: 'delivery',
  channel: 'stable',
  channelUrl: 'http://127.0.0.1:3000/v1/channels/delivery/stable',
};
```

`manifestUrl` remains a Debug/local compatibility escape hatch for a direct
signed release envelope. Production delivery should use a signed channel
pointer and the embedded public-key verifier before using Cloudflare R2.

For a one-off internal Release build against the LAN server, set
`LYNX_ALLOW_LOCAL_MANAGED_RELEASE=1` while installing the example app's Pods:

```sh
cd apps/expo-lynx-example/ios
LYNX_ALLOW_LOCAL_MANAGED_RELEASE=1 pod install
```

The Podfile applies the Swift compilation condition to the `ExpoLynx` pod,
where `ExpoLynxView.swift` is compiled. The native guard is
`#if !DEBUG && !LYNX_ALLOW_LOCAL_MANAGED_RELEASE`. Do not set this environment
variable for production pod installs: the flag permits unsigned HTTP managed
endpoints for local testing.

### React Native splash while a managed bundle loads

`onLoadStart` fires before Lynx starts a selected embedded, cached, development, or downloaded bundle. `onLoad` is the successful Lynx render callback and includes the selected `source`; `onError` reports a failed delivery/render stage. A managed source may load the embedded fallback while it downloads its first release, so keep the splash visible for an `embedded` success when the requested source is still `managed`:

```tsx
const [showSplash, setShowSplash] = useState(true);

<View style={{ flex: 1 }}>
  <ExpoLynxView
    source={source}
    onLoadStart={() => setShowSplash(true)}
    onLoad={({ nativeEvent }) => {
      if (source.kind !== 'managed' || nativeEvent.source !== 'embedded') {
        setShowSplash(false);
      }
    }}
    onError={() => setShowSplash(false)}
    style={{ flex: 1 }}
  />
  {showSplash ? <MiniAppSplash /> : null}
</View>;
```

Position `MiniAppSplash` absolutely over the native view and let it accept pointer events if it should block interaction until the mini-app is ready. On a managed cache hit, `onLoad` reports `source: "cache"`; after a first successful remote install it reports `source: "download"`.

The view exposes `reload()` and a non-blocking signed-channel check through its
ref. `checkForUpdate()` uses the currently configured managed source, so the
imperative API cannot override the endpoint, public key, or channel state. Its
result is `no-update` or `pending`; `pending` means the verified release is
ready for the next open, not that the visible mini-app changed.

```tsx
import { useRef } from 'react';
import { ExpoLynxView, type ExpoLynxViewRef } from 'expo-lynx';

const lynxRef = useRef<ExpoLynxViewRef>(null);

await lynxRef.current?.reload();

const result = await lynxRef.current?.checkForUpdate();
// { feature: 'delivery', channel: 'stable', status: 'no-update' | 'pending', ... }
```

Use `onUpdate` to drive a small “checking/downloading/ready next time” status
without keeping the primary splash screen up. The event intentionally excludes
URLs, headers, local paths, and bundle content:

```tsx
<ExpoLynxView
  ref={lynxRef}
  source={source}
  onUpdate={({ nativeEvent }) => {
    if (nativeEvent.phase === 'staged') {
      showToast(`Version ${nativeEvent.version} is ready for next open`);
    }
  }}
/>
```

Use HTTPS for production resources. Plain HTTP is intended only for the local Debug workflow and requires an App Transport Security local-network exception in the consuming app.

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
