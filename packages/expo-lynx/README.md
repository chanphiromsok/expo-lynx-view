# expo-lynx-view

Embed a compiled Lynx page inside an Expo or React Native app on iOS. The module wraps the native `LynxView` from Lynx 4.0 and keeps its exact layout constraints synchronized with the React Native view.

## Install

Add this package to an Expo development build, then regenerate/install the iOS native dependencies:

```json
{
  "expo": {
    "plugins": [
      [
        "expo-lynx-view",
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

> **Current limitation — Lynx images are unavailable.** The iOS package does
> not include `LynxService/Image`, because Lynx 4.0.x pins an SDWebImage version
> that conflicts with current Expo hosts. Do not use Lynx `<image>` elements:
> embedded, remote, WebP, GIF, and animated images will not render. Release ZIPs
> continue to preserve `static/**` files for a future compatible image service.

The config plugin keeps Lynx's CocoaPods target on its required GNU C++ dialect, applies the Xcode 26 warning compatibility flags, and can copy static Lynx bundles into the iOS application bundle. Run prebuild again after changing the plugin configuration.

## Use

```tsx
import { ExpoLynxView } from 'expo-lynx-view';

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
signed deployment in the background. A new signed ZIP is fully verified during
installation and staged for the next mini-app open; it never replaces a mounted
view. The legacy `url` prop remains available for compatibility, but Release
iOS builds reject raw remote URLs.

For a bundled resource, add the `.lynx` bundle and every Rspeedy sidecar directory to `bundledResources`. Directory structure is preserved in both the embedded baseline and a managed release. This does not currently enable Lynx `<image>` rendering; see the limitation above.

### Feature-name autocomplete for V2 embedded bundles

When V2 `embeddedBundlesPath` is configured, Expo prebuild validates its
`registry.json` and writes a sibling declaration file at
`generated/expo-lynx/lynx-features.d.ts`. The file augments `expo-lynx-view` with
the exact canonical feature IDs. After prebuild, editors autocomplete those IDs
and TypeScript rejects an unknown `source.feature` value:

```tsx
const source: LynxSource = {
  kind: 'managed',
  feature: 'shopping', // autocomplete comes from the embedded registry
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

The example's ReactLynx source now lives at
`apps/expo-lynx-example/features/delivery`. Start the local Console/Worker,
open the Expo app, then release the feature:

```sh
pnpm lynx console
pnpm start
pnpm lynx release delivery
```

`lynx release` builds the feature, creates an immutable ZIP, uploads it to R2,
and registers it with the Worker. Open the Console and select/enabled the new
bundle. The generated embedded baseline remains separate, so the first remote
release visibly exercises the managed `embedded → download` transition. A
physical iPhone must use a LAN Worker URL for local testing; do not use
`localhost` from a phone.

For signed V2 delivery, configure every production endpoint in the Expo plugin.
Prebuild writes this map into `Info.plist`, and native code resolves the
endpoint from the feature. The native view first renders the current cache
or embedded baseline, then sends a small ETag revalidation request. A `304` or
an unchanged release ID does not download a ZIP, extract files, or rehash
cached content. Only a signed deployment selecting a new release downloads and
installs the ZIP; that release activates on the next mini-app open.

```json
{
  "expo": {
    "plugins": [
      [
        "expo-lynx-view",
        {
          "embeddedBundlesPath": "./generated/expo-lynx/embedded",
          "publicKeyPath": "./keys/lynx/updates.public.pem",
          "deliveryEndpoints": {
            "delivery": "https://delivery.example.com/v1/default/delivery"
          }
        }
      ]
    ]
  }
}
```

```tsx
const source: LynxSource = {
  kind: 'managed',
  feature: 'delivery',
};
```

`channelUrl` and `manifestUrl` remain Debug/local compatibility escape hatches.
Production delivery uses the build-time endpoint map and embedded public-key
verifier before using Cloudflare R2. The app also sends its build-time Expo
runtime fingerprint, so it never opens a cached remote bundle from another
native app version.

For a one-off internal Release build against the LAN server, set
`LYNX_ALLOW_LOCAL_MANAGED_RELEASE=1` while installing the example app's Pods:

```sh
cd apps/expo-lynx-example/ios
LYNX_ALLOW_LOCAL_MANAGED_RELEASE=1 pod install
```

The Podfile applies the Swift compilation condition to the `ExpoLynx` pod's
Release configuration. The native guard is
`#if !DEBUG && !LYNX_ALLOW_LOCAL_MANAGED_RELEASE`. Do not set this environment
variable for production pod installs: the flag permits cleartext HTTP managed
endpoints for local testing. Deployment signatures and bundle hashes are still
verified.

### Measure an internal Release build

IFR timing logs are absent from normal Release builds. For a one-off internal
Release build, opt in while installing Pods:

```sh
cd apps/expo-lynx-example/ios
LYNX_IFR_METRICS=1 pod install
```

This adds `LYNX_IFR_METRICS` only to the `ExpoLynx` pod's Release compilation
conditions. Build and install the internal Release app, then stream its `IFR`
logs with the same `xcrun simctl` command below. Run a normal `pod install`
without the environment variable before creating a production archive.

### React Native splash while a managed bundle loads

`onLoadStart` fires before Lynx starts a selected embedded, cached, development,
or downloaded bundle. `onLoad` fires when Lynx completes first-screen layout
and includes the selected `source`; `onError` reports a failed delivery/render
stage. A managed source may load its embedded fallback while a new release
stages for the next open. The embedded fallback is usable UI, so hide the
blocking splash on every successful `onLoad` and use `onUpdate` for non-blocking
delivery status:

```tsx
const [showSplash, setShowSplash] = useState(true);

<View style={{ flex: 1 }}>
  <ExpoLynxView
    source={source}
    onLoadStart={() => setShowSplash(true)}
    onLoad={() => setShowSplash(false)}
    onError={() => setShowSplash(false)}
    style={{ flex: 1 }}
  />
  {showSplash ? <MiniAppSplash /> : null}
</View>;
```

Position `MiniAppSplash` absolutely over the native view and let it accept
pointer events until the first usable local mini-app render. On a managed cache
hit, `onLoad` reports `source: "cache"`; a first remote install stages for the
next mini-app open and reports its progress through `onUpdate`.

The module exposes a non-blocking signed deployment check by feature. Its
endpoint comes from the build-time native map, so the imperative API cannot
override the endpoint, public key, or deployment state. Its result is `no-update`
or `pending`; `pending` means the verified release is ready for the next open,
not that the visible mini-app changed. The view ref retains only `reload()`.

```tsx
import ExpoLynx, { ExpoLynxView } from 'expo-lynx-view';

const result = await ExpoLynx.checkForUpdate({
  feature: 'delivery',
});
// { feature: 'delivery', status: 'no-update' | 'pending', ... }
```

Use `onUpdate` to drive a small “checking/downloading/ready next time” status
without keeping the primary splash screen up. The event intentionally excludes
URLs, headers, local paths, and bundle content:

```tsx
<ExpoLynxView
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

For HMR, run Rspeedy's development server from the in-repository delivery
feature:

```sh
cd apps/expo-lynx-example/features/delivery
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
