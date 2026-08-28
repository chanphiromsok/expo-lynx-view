---
name: expo-lynx-integration
description: Embed the Lynx rendering engine in an Expo or React Native app via the `expo-lynx` package. Covers dev (rspeedy `pnpm dev` + LAN URL) and prod (HTTPS CDN) bundle loading, the `ExpoLynxView` props contract, required ATS/Info.plist flags, common runtime errors (code 201, missing `LynxWebSocketModule`, HMR crashes), and the source-picker pattern for flipping between static / dev / prod bundles. Use when integrating, debugging, or shipping a Lynx view inside an Expo or React Native host app. Not for building Lynx itself — see the `lynx` repo's AGENTS.md for engine-side work.
license: MIT
---

# Embedding Lynx in an Expo / React Native App

The `expo-lynx` package is the bridge. It hosts a `LynxView` (`Lynx/Framework` 4.0) inside a native view, downloads the `.lynx.bundle`, and forwards engine errors to React.

## The bridge in one paragraph

iOS: `ios/ExpoLynxView.swift` builds a `LynxView`, then `loadRemoteURL` (line 131) uses `URLSession` to fetch the bundle bytes and `lynxView.loadTemplate(data, withURL:, initData:)` (line 178) hands them to the engine. `didRecieveError` is forwarded through `onError` as `{ url, code, message }` (code is the engine's integer error code as a string). Android: `android/src/main/java/expo/modules/lynx/ExpoLynxView.kt` is currently a placeholder — Lynx is iOS-only in this package.

## URL contract

`ExpoLynxView.url` accepts:

| Form | Means |
|---|---|
| `https://cdn.example.com/main.lynx.bundle` | Production bundle. ATS-clean. |
| `http://<lan-ip>:<port>/main.lynx.bundle` | Dev bundle from `rspeedy dev`. Requires ATS exception. |
| `static.lynx` / `bundle://static.lynx` | Bundled resource resolved from the iOS app bundle. Use for demos and unit tests. |
| `file://…` | Local file URL. |

The iOS host routes by scheme in `loadSource` (`ExpoLynxView.swift:118`): `http`/`https` → URLSession fetch; anything else → `Bundle.main.url(forResource:withExtension:)` lookup.

## Dev workflow

1. In the bundle source project (e.g. `~/Desktop/lynx-source`), `pnpm dev`. Rspeedy serves `main.lynx.bundle` and `main.web.bundle` at `:3000`.
2. Pass `http://<lan-ip>:3000/main.lynx.bundle` to `ExpoLynxView.url`. The LAN IP must be reachable from the device/simulator.
3. **ATS must allow cleartext HTTP to the LAN IP.** Two options:
   - `NSAllowsLocalNetworking = true` in Info.plist (already on in `example/ios/expolynxexample/Info.plist`). Covers most LAN segments.
   - Narrow `NSExceptionDomains` per host if a stricter posture is required.
4. **HMR / live-reload inside the view is OFF by default** and currently must stay off. The embedded iOS Lynx runtime (4.0.0) does not ship `LynxWebSocketModule`. The rspeedy dev bundle's HMR client (`@lynx-js/webpack-dev-transport`) calls `new WebSocket(...)` at module-top-level and throws `Error: WebSocket is not found. Please use Lynx >= 2.16 or consider using a polyfill.` That throw propagates as error code 201 (`LynxErrorCodeJavaScript`) and crashes the page. Fix is in the bundle source's rspeedy config:

```ts
// lynx.config.ts
export default defineConfig({
  environments: {
    lynx: {
      dev: {
        // ponytail: embedded iOS Lynx doesn't ship LynxWebSocketModule;
        // turning HMR/live-reload off stops webpack-dev-transport from throwing.
        hmr: false,
        liveReload: false,
      },
    },
  },
});
```

If you want real live-reload inside the view later, register a native `LynxWebSocketModule` in the host and flip these back on. That's a 30-line Swift class + Objective-C `LynxModule`-conforming bridge — not worth it for one-off dev.

5. To re-fetch after edits, call the ref's `reload()` method or re-mount the view.

## Prod workflow

1. `pnpm build` in the bundle source → `dist/main.lynx.bundle`.
2. Upload to any HTTPS CDN. Use a content-hashed path so `URLSession` `.reloadRevalidatingCacheData` (`ExpoLynxView.swift:135`) returns 304 cleanly.
3. Pass `https://cdn.example.com/<hash>/main.lynx.bundle` to `ExpoLynxView.url`. No ATS changes needed.
4. Same `LynxView loadTemplateFromURL:` path inside the host. No dev-only branches.

## Props

```ts
type ExpoLynxViewProps = {
  url: string;                        // required: bundle URL or bundled resource name
  initialData?: Record<string, unknown>; // forwarded as LynxTemplateData, available via useInitData()
  onLoadStart?: (e: { url: string }) => void;
  onLoad?:       (e: { url: string }) => void;
  onError?:      (e: { url: string; code: string; message: string }) => void;
};
```

The view exposes a ref with `reload(): Promise<void>`.

## Source-picker pattern for dev (one file, three URLs)

Use `expo-constants` to read URL config from `app.json`, then render three buttons. See `example/App.tsx` for the full pattern. Keep the three URLs in `app.json`:

```json
{
  "expo": {
    "extra": {
      "lynxDevBundleHost": "192.168.28.196",
      "lynxDevBundlePort": 3000,
      "lynxProdBundleUrl": "https://cdn.example.com/main.lynx.bundle"
    }
  }
}
```

This keeps the dev IP out of source control, lets prod builds point at the CDN, and lets QA repro a CDN bug locally by tapping the dev button.

## Bundling a static `.lynx` for the demo app

The `app.plugin.js` config plugin (`example/app.plugin.js`) accepts `bundledResources`:

```json
"plugins": [
  ["../app.plugin.js", { "bundledResources": ["./assets/static.lynx"] }]
]
```

The plugin copies each listed `.lynx` into the iOS app bundle at build time. Reference by name (`"static.lynx"`) — the host's `resolveLocalURL` (`ExpoLynxView.swift:197`) looks it up via `Bundle.main.url(forResource:withExtension:)`.

## Common errors

| Symptom | Likely cause | Fix |
|---|---|---|
| Error code 201, generic NSError message | Engine-side JS exception. The host flattens NSError → loses cause. | Look at Xcode console for the embedded `Lynx error` line — it has the real `rawError.message` and stack. |
| Error code 201, `Error: WebSocket is not found` | HMR/live-reload bundle tried to open a WS at module load; embedded runtime has no WS module. | Set `hmr: false, liveReload: false` in the bundle source's `lynx.config.ts`. |
| HTTP 200 bundle but no page renders | Wrong SDK / engine version mismatch. `engine_version` in the bundle header must be ≤ the host's Lynx SDK. | Rebuild the bundle with the matching `@lynx-js/rspeedy` and re-export `lynx_core.js` for the host. |
| ATS cleartext error in Xcode console | `NSAllowsArbitraryLoads = false` and no LAN exception. | Add `NSAllowsLocalNetworking = true` (broad) or narrow `NSExceptionDomains`. |
| Error 102 (`LynxErrorCodeLoadTemplate`) | Bundle bytes corrupt or truncated. | Re-download with `curl -I` and compare `Content-Length` to the build artifact. |
| Bundle loads but page is blank / no console | `initialData` shape doesn't match what the page's `useInitData` expects. | Check the page side first; the host just passes the JSON through. |

## What's intentionally NOT here

- **A native `LynxWebSocketModule` for real HMR.** 30 lines of Swift + an Obj-C bridge, easy to add, but you lose live-reload by disabling it in the dev config and that's almost always the right trade. Add when iteration speed inside the view matters more than the setup cost.
- **A JS console forwarder.** The bridge currently only forwards `onError`. Routing the engine's `console.error` into React Native's LogBox is doable via the Lynx DevTool SDK, but it's a separate 50-line native change. Add when you need to debug without Xcode attached.
- **Code / sub-code → human name mapping.** `LynxErrorCode.m` (`platform/darwin/common/lynx/`) has the integer mapping. Translate in the host if you want named errors. Skip until you have more than two of these firing per day.

## Quick checklist for a fresh integration

- [ ] Bundle source project has `hmr: false, liveReload: false` under `environments.lynx.dev` in `lynx.config.ts`.
- [ ] Host Info.plist has `NSAllowsLocalNetworking = true` (or narrower exception) for the LAN dev URL.
- [ ] `ExpoLynxView.url` is parameterized via `expo-constants` `extra.lynxProdBundleUrl` / `lynxDevBundleHost` / `lynxDevBundlePort`.
- [ ] `app.plugin.js` `bundledResources` lists any demo `.lynx` you want available offline.
- [ ] `onError` handler reads `nativeEvent.code` and `nativeEvent.message` and logs both — Xcode console for the underlying stack.
- [ ] For prod: CDN URL is HTTPS, content-hashed, cache-control permits revalidation.