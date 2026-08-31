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

For a physical **internal Release** test over local HTTP, add
`LYNX_ALLOW_LOCAL_MANAGED_RELEASE` to that configuration's
`SWIFT_ACTIVE_COMPILATION_CONDITIONS` in Xcode, rebuild, and remove it from any
distributable configuration. The flag changes only the HTTP transport gate: the
release still verifies the embedded public key, envelope signature, archive,
CRC, and file hashes. A normal Release build continues to accept signed HTTPS
only.

## Persistent local delivery service: upload, promote, and serve

For a physical-device test that mirrors the production Worker route contract,
use the persistent local delivery service. It stores test artifacts in an
ignored local directory, requires a publisher bearer token for uploads and
promotion, and exposes the same public V2 channel, manifest, and ZIP routes
used by a production server.

If the local key pair was just generated, make the public half the key the
plugin embeds before starting the service. The following native step is needed
once for the trust-root change, not for later bundle releases:

```sh
cp apps/expo-lynx-example/.local-lynx-keys/updates.public.pem \
  apps/expo-lynx-example/keys/lynx/updates.public.pem
cd apps/expo-lynx-example
npx expo prebuild --platform ios
cd ../..
```

```sh
export LYNX_DELIVERY_LOCAL_TOKEN="$(openssl rand -hex 32)"

pnpm lynx-delivery serve -- \
  --host 0.0.0.0 \
  --port 3000 \
  --token "$LYNX_DELIVERY_LOCAL_TOKEN" \
  --private-key apps/expo-lynx-example/.local-lynx-keys/updates.private.pem \
  --public-key apps/expo-lynx-example/keys/lynx/updates.public.pem
```

Use the printed device channel URL in the Expo plugin `deliveryChannels` map
before making the internal iOS build. The map is compiled into `Info.plist`, so
a changed LAN IP requires another prebuild/rebuild; uploading and promoting a
new signed release at an unchanged URL does not.

Create, upload, and promote a release without any native rebuild:

```sh
pnpm lynx-bundle pack delivery \
  --config apps/expo-lynx-example/lynx-bundle.config.mjs \
  --release-id delivery-2026.08.30.1 \
  --version 2026.08.30.1 \
  --platform ios \
  --runtime-version expo-57

pnpm lynx-delivery publish -- \
  --server http://192.168.18.144:3000 \
  --token "$LYNX_DELIVERY_LOCAL_TOKEN" \
  --release-dir apps/expo-lynx-example/dist/lynx-releases/delivery/delivery-2026.08.30.1 \
  --channel active
```

Replace the IP address with the service's printed LAN address. The `publish`
command performs the authenticated manifest upload, streamed ZIP upload with
signed hash/length verification, then signed `next-open` channel promotion. It
is safe to repeat; differing bytes for a reused release ID are rejected.

Run the service integration test with `pnpm test:lynx-delivery`. It starts only
a temporary loopback HTTP server; it does not invoke an iOS build.

## One-shot rebuild and serve a remote release

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
GET /v1/channels/delivery/active
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
