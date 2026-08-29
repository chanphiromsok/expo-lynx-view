# iOS local signed Lynx release testing

This workflow tests the same V2 signed ZIP contract used by remote delivery:
an RSA-SHA256 release envelope, `release.zip`, archive SHA-256, streamed ZIP
extraction, per-file SHA-256, and atomic installation. It does **not** use Expo
Updates to deliver the Lynx mini-app.

## One-time native setup

The example contains the committed development public key at
`apps/expo-lynx-example/keys/lynx/updates.public.pem`. Its matching private key
is created locally under `.local-lynx-keys/` and is ignored by Git.

```sh
node packages/lynx-bundle-cli/bin/lynx-bundle.mjs keys generate \
  --output-dir apps/expo-lynx-example/.local-lynx-keys
node packages/lynx-bundle-cli/bin/lynx-bundle.mjs build-embedded \
  --config apps/expo-lynx-example/lynx-bundle.config.mjs \
  --runtime-version expo-57
cd apps/expo-lynx-example
npx expo prebuild --platform ios
```

`prebuild` and an iOS rebuild are required when the public key, embedded
baseline, native plugin, or feature map changes. A normal remote release
rebuild does **not** require prebuild.

## Rebuild and serve a remote release

Run this at the repository root. It rebuilds the selected feature through the
S01 bundle CLI, produces a signed ZIP, then starts a LAN-reachable server.

```sh
node scripts/serve-local-lynx-release.mjs --feature delivery --port 3000
```

The command prints both a Simulator and a device URL. Set the example's
`devHost` in `apps/expo-lynx-example/App.tsx` to the printed device host; a
phone must never use `localhost`.

The current iOS managed-source field uses the local-only compatibility endpoint
`/manifest.json`. It returns the **exact same signed `lynx-release` envelope**
as the immutable release route. The server also exposes the future channel
route:

```text
GET /v1/channels/delivery/stable
GET /v1/releases/delivery/<releaseId>/manifest
GET /v1/releases/delivery/<releaseId>/release.zip
```

Before testing native code, open the printed device envelope URL in Mobile
Safari. If it cannot load, check that the phone and Mac are on the same Wi-Fi,
disable VPN/client isolation, and allow the chosen port through the macOS
firewall.

## Test checklist

1. Build/install the iOS app, open **Managed cache**, and confirm the React
   Native splash remains visible until `onLoad` reports `cache` or `download`.
2. Confirm the initial offline baseline renders if the release cannot download.
3. Re-run the server command to create a different release ID; reload for
   `on-launch`, or close/open for `next-open` once M04 channel activation is
   enabled.
4. Stop the server, reopen the app, and confirm the installed cache loads with
   no network request or full content rehash.
5. Start the server with one fault flag and confirm an error callback occurs
   while the embedded/current working UI remains available:

```sh
node scripts/serve-local-lynx-release.mjs --fault corrupt-archive
node scripts/serve-local-lynx-release.mjs --fault invalid-signature
node scripts/serve-local-lynx-release.mjs --fault 404
node scripts/serve-local-lynx-release.mjs --fault delay
```

The local server emits ETags. Repeating a request with `If-None-Match` returns
`304`; the app must treat a release ID and signed bytes as identity, never a
cache-busting query parameter.
