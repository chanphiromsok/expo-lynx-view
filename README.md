# Expo Lynx monorepo

This repository contains the iOS Expo module that embeds Lynx mini-apps, a
signed-bundle producer CLI, an example Expo application, and the starting
point for the Cloudflare delivery service.

The intended production model is deliberately different from loading an
arbitrary URL in a WebView:

1. A mini-app feature has an embedded static bundle in the native app, which
   is always available as an offline fallback.
2. The release producer builds that feature, packages its bundle and sidecars
   into a deterministic `release.zip`, and signs an exact release payload with
   the app's private RSA key.
3. The native app uses its embedded public key to verify a signed channel
   response and release before installing it. A verified release becomes active
   on the next mini-app open; it never replaces a mounted view.

The implementation is iOS-first. Android delivery is intentionally deferred.

## Requirements

- Node.js 20 or later
- pnpm 11.24.0 (the version pinned in `package.json`)
- Xcode only when you intentionally need a native iOS build
- A Cloudflare account and Wrangler authentication only when you deploy the
  delivery Worker

Install the workspace dependencies from the repository root:

```sh
pnpm install
```

Useful non-native checks are:

```sh
pnpm lint
pnpm test
pnpm build
```

`pnpm ios` creates/runs a native iOS build and is intentionally not part of
the normal setup or bundle-release workflow.

## Repository layout

| Path | Purpose |
| --- | --- |
| `packages/expo-lynx` | Expo native module, config plugin, and iOS managed-bundle implementation. |
| `packages/lynx-bundle-cli` | Builds, packages, hashes, and signs each Lynx feature. |
| `apps/expo-lynx-example` | Reference Expo app and its `delivery` mini-app feature. |
| `apps/expo-lynx-example/features/delivery` | The ReactLynx mini-app source, now part of this monorepo. |
| `apps/lynx-delivery-worker` | Cloudflare Worker service scaffold for the production delivery API. |
| `scripts/serve-local-lynx-release.mjs` | Local signed-release server for simulator or trusted-LAN device testing. |

## Everyday mini-app workflow

Use the friendly `lynx` command for normal development. It generates internal
release identities and local publisher tokens for you; no manual date version,
release ID, PEM path, output directory, or upload route is required.

```sh
# First-time development-key setup. It deliberately requires this explicit
# flag because it replaces the public key embedded in the example app.
pnpm lynx local init --replace-app-key

# Starts the LAN-reachable local delivery service and stores its token only in
# ignored .local-lynx-delivery/ state.
pnpm lynx local start

# Rebuild static native-resource input from the actual delivery source.
pnpm lynx bundle delivery

# Build → sign → upload → promote the local stable channel.
pnpm lynx release delivery

# Inspect the current local channel head.
pnpm lynx status delivery
```

`pnpm lynx release delivery` generates an immutable release ID and a display
version automatically. Use `--draft` to package without publishing, or
`--channel beta` when testing a different configured channel. A changed
embedded public key, feature registry, or channel-host mapping still requires
one Expo prebuild and internal iOS build; a later `lynx release` does not.

## Set up a mini-app feature

The consuming Expo app owns `lynx-bundle.config.ts` (or `.mjs`). Feature keys
are canonical IDs: a `shopping` entry resolves to
`<featuresDir>/shopping`, so the feature ID and its project root are not
repeated in configuration.

```ts
import { defineConfig } from '@expo-lynx/bundle-cli';

export default defineConfig({
  featuresDir: './features',
  features: {
    shopping: {},
    orders: { entry: './src/main.tsx' },
  },
  // Kept outside Metro's imported asset graph so these resources are not
  // duplicated in the React Native JavaScript bundle.
  embeddedOutputDir: './generated/expo-lynx/embedded',
  releaseOutputDir: './dist/lynx-releases',
  signing: {
    privateKeyPath:
      process.env.LYNX_SIGNING_PRIVATE_KEY_PATH ??
      './.local-lynx-keys/updates.private.pem',
  },
});
```

Unless a feature supplies an advanced `build` wrapper, it must contain
`src/index.tsx` and `lynx.config.ts`. The CLI accepts only
`main.lynx.bundle` plus its `static/**` sidecars from the feature build.

Build static embedded resources for the app runtime, then validate the result:

```sh
pnpm lynx bundle delivery
```

The lower-level `pnpm lynx-bundle build-embedded` and `check-embedded`
commands remain available for CI and diagnostics.

`generated/expo-lynx/embedded` is config-plugin input, not an Expo/Metro
asset import. When it is configured as `embeddedBundlesPath`, prebuild also
generates `generated/expo-lynx/lynx-features.d.ts` so `ExpoLynxView` source
features autocomplete and TypeScript rejects unknown feature names.

## Generate the signing PEM key pair

Generate a local development key pair once for an app:

```sh
pnpm lynx-bundle keys generate \
  --output-dir apps/expo-lynx-example/.local-lynx-keys
```

This produces:

| File | Format and purpose | Handling |
| --- | --- | --- |
| `updates.private.pem` | 3072-bit RSA PKCS#8 private signing key | Secret. Owner-only permissions (`0600`); never commit, upload to R2, or include in the mobile app. |
| `updates.public.pem` | RSA SubjectPublicKeyInfo public verification key | Safe to embed in the app and distribute with its build configuration. |

The CLI will refuse to overwrite an existing pair. It signs exact payload bytes
with RSA PKCS#1 v1.5 plus SHA-256 (`RSA-SHA256`) and emits base64url
signatures. SHA-256 by itself is only a digest: it detects accidental changes
but cannot prove who published the release. The private-key signature provides
that authenticity; the app verifies it using the embedded public key.

For the example, copy or replace the development public key at
`apps/expo-lynx-example/keys/lynx/updates.public.pem`, and keep the matching
private key only under the ignored `.local-lynx-keys/` directory. Configure the
public key and embedded resources in the Expo plugin:

```json
{
  "expo": {
    "plugins": [
      [
        "expo-lynx",
        {
          "embeddedBundlesPath": "./generated/expo-lynx/embedded",
          "publicKeyPath": "./keys/lynx/updates.public.pem",
          "deliveryChannels": {
            "shopping": {
              "stable": "https://delivery.example.com/v1/channels/shopping/stable"
            }
          }
        }
      ]
    ]
  }
}
```

One app-wide public key is the normal starting point, including for multiple
mini-apps. It gives one trust root for every configured feature. Rotate to a
new key by shipping the new public key in a native app update before signing
releases with its private counterpart. Do not use a different key merely
because a feature is different unless isolation or separate publisher control
is an explicit requirement.

## Build and package a remote release

The static embedded bundle is the baseline; a remote release is a separate
signed artifact. Packaging a new release does **not** alter or rebuild the
React Native JavaScript bundle.

```sh
pnpm lynx-bundle pack shopping \
  --release-id shopping-2026.08.30.1 \
  --version 2026.08.30.1 \
  --platform ios \
  --runtime-version expo-57
```

The configured `releaseOutputDir` receives:

```text
dist/lynx-releases/shopping/shopping-2026.08.30.1/
  release.zip
  release-payload.json
  release-envelope.json
  packaging-report.json
```

Upload the immutable ZIP and signed envelope to your artifact store only after
the server-side channel pointer is ready. A channel endpoint is then the small
signed decision document that points a feature/channel at the new immutable
release. The mobile app uses these canonical routes:

```text
GET /v1/channels/:feature/:channel
GET /v1/releases/:feature/:releaseId/manifest
GET /v1/releases/:feature/:releaseId/release.zip
```

## Test signed delivery locally

### Persistent, production-shaped local service

For a realistic phone test, use the persistent local delivery service. It has
the same public client route shape as the Worker, requires a bearer token for
operator requests, accepts a signed manifest and ZIP through separate bounded
upload routes, makes artifacts public only after the ZIP hash/length match, and
promotes channels by creating a new signed monotonic revision. It stores only
local test data in the ignored `.local-lynx-delivery/` directory.

Generate a local publisher token and start the service. The private key remains
on the development Mac; the service uses it only to sign channel envelopes.
If this is a fresh development pair, first copy its **public** half to the Expo
plugin path and make a new internal build so the app embeds the matching trust
root. Do not copy the private PEM anywhere outside `.local-lynx-keys/`.

```sh
cp apps/expo-lynx-example/.local-lynx-keys/updates.public.pem \
  apps/expo-lynx-example/keys/lynx/updates.public.pem

# Required once after changing the embedded public key; not required per release.
cd apps/expo-lynx-example
npx expo prebuild --platform ios
cd ../..

export LYNX_DELIVERY_LOCAL_TOKEN="$(openssl rand -hex 32)"

pnpm lynx-delivery serve -- \
  --host 0.0.0.0 \
  --port 3000 \
  --token "$LYNX_DELIVERY_LOCAL_TOKEN" \
  --private-key apps/expo-lynx-example/.local-lynx-keys/updates.private.pem \
  --public-key apps/expo-lynx-example/keys/lynx/updates.public.pem
```

It prints a loopback URL and every reachable LAN channel URL. Use the printed
LAN URL—not `localhost`—in the `deliveryChannels` entry embedded in an iPhone
build. Because that map is native `Info.plist` configuration, changing the
host/IP requires a prebuild and new internal app build; publishing subsequent
remote releases to the same URL does not.

Build and package a named release, then upload and promote it from the
publisher CLI. The `publish` command reads only `release-envelope.json` and
`release.zip` from the given release directory; it does not expose the private
key to the phone or upload it to the server storage.

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
  --channel stable \
  --activation next-open
```

Replace `192.168.18.144` with the LAN address printed by your service. This
publishes these exact routes:

```text
PUT  /v1/admin/releases/:feature/:releaseId/manifest
PUT  /v1/admin/releases/:feature/:releaseId/archive
POST /v1/admin/channels/:feature/:channel/promote

GET  /v1/channels/:feature/:channel
GET  /v1/releases/:feature/:releaseId/manifest
GET  /v1/releases/:feature/:releaseId/release.zip
```

The three `PUT`/`POST` routes are operator-only and require the bearer token.
The three `GET` routes are client-facing: channel responses use `no-cache` plus a strong
ETag/`304`, while the feature-scoped manifest and ZIP are immutable and use
long-lived cache headers. Repeating the same upload and CLI idempotency key is
safe; attempting different content under an existing release ID fails rather
than overwriting an artifact.

Run the no-native integration test at any time:

```sh
pnpm test:lynx-delivery
```

It runs a loopback-only temporary server and verifies unauthorized upload
rejection, signed upload, promotion, idempotent republish, ETag `304`, and exact
manifest/ZIP response bytes. It does not run Expo prebuild, Pods, Xcode, or an
iOS simulator.

### One-shot static server

The root static server remains the fastest smoke test. It builds and signs a
fresh local `delivery` release, serves it from `0.0.0.0:3000`, and prints a
simulator URL plus reachable LAN addresses for a physical iPhone:

```sh
pnpm serve:lynx-local
```

Use the printed LAN IP in the example app's local development configuration;
never use `localhost` from a phone. First open the printed channel URL in
Mobile Safari on the phone. If it cannot load, the app cannot load it either:
check that both devices share Wi-Fi, VPN/client isolation is disabled, and the
macOS firewall allows the port.

The local server is for a trusted development LAN only. Production release
endpoints must use HTTPS and remain protected by the embedded-key signature,
archive hash, streamed ZIP checks, and extracted-file hashes.

For a test fault, pass one of the supported fault modes:

```sh
pnpm serve:lynx-local -- --fault corrupt-archive
pnpm serve:lynx-local -- --fault invalid-signature
pnpm serve:lynx-local -- --fault 404
pnpm serve:lynx-local -- --fault delay
```

## Cloudflare server scaffold

`apps/lynx-delivery-worker` is the server scaffold already checked into this
monorepo. It currently provides `GET /` and `GET /health` and declares the R2
artifact bucket and D1 database bindings. The signed release and channel
routes above are the next Worker implementation milestone; they are not
implemented by the scaffold yet.

Start the skeleton locally:

```sh
pnpm --filter @expo-lynx/lynx-delivery-worker dev
curl http://127.0.0.1:8787/health
```

Provision its Cloudflare resources, then replace the placeholder D1
`database_id` in `apps/lynx-delivery-worker/wrangler.toml` with the returned
value:

```sh
cd apps/lynx-delivery-worker
pnpm exec wrangler r2 bucket create lynx-artifacts
pnpm exec wrangler d1 create lynx-delivery
pnpm exec wrangler deploy
```

There is currently no `lynx-bundle scaffold-server` generator command. The
checked-in Worker is the authoritative scaffold. Keeping that explicit avoids
suggesting that a generated Worker already implements secure publication,
channel signing, R2 upload, or D1 migrations.

## When an iOS prebuild is required

Run Expo prebuild and make a new native iOS build only when the native app
inputs change, for example:

- adding or removing an embedded feature;
- changing `embeddedBundlesPath`, `publicKeyPath`, or the configured delivery
  channel map;
- rotating the embedded public key; or
- updating the native module/plugin.

Creating, signing, uploading, or switching to a new remote release does **not**
need prebuild or a new iOS binary. The app verifies the new signed release at
installation time and opens it on the next mini-app launch.

For detailed iOS local testing and the delivery architecture, see
[`docs/ios-local-signed-lynx-testing.md`](./docs/ios-local-signed-lynx-testing.md)
and the package-level [delivery development guide](./packages/expo-lynx/feature/delivery-bundle-update/DEVELOPMENT.md).
