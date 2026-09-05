# Expo Lynx monorepo

This repository contains the iOS Expo module that embeds Lynx mini-apps, the
release CLI, an example Expo application, and the Cloudflare delivery console.

The intended production model is deliberately different from loading an
arbitrary URL in a WebView:

1. A mini-app feature has an embedded static bundle in the native app, which
   is always available as an offline fallback.
2. The release CLI builds and packages an immutable `release.zip`, then signs
   and uploads it directly to R2 with its local R2 credential.
3. The Worker verifies the ZIP, records it as immutable in D1, and the Console
   selects one deployment for each app, feature, and native runtime. The Worker
   signs the exact deployment response. The native app verifies that response
   with its embedded public key before installation.

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
| `packages/expo-lynx` | Source for the published `expo-lynx-view` Expo native module, config plugin, and iOS managed-bundle implementation. |
| `packages/lynx-bundle-cli` | Will publish as `expo-lynx-bundle-cli`; builds, packages, hashes, and uploads each Lynx feature. |
| `apps/expo-lynx-example` | Reference Expo app and its `delivery` mini-app feature. |
| `apps/expo-lynx-example/features/delivery` | The ReactLynx mini-app source, now part of this monorepo. |
| `apps/docs` | MDX documentation website for setup, managed delivery, CLI, and troubleshooting. |
| `apps/console` | Unified TanStack operator console and Elysia/Cloudflare Worker for signed delivery artifacts. |

## Everyday mini-app workflow

Use these three commands for normal local development. No Wrangler flags or
release directory paths are required.

```sh
# Terminal 1: local Worker plus browser delivery console.
pnpm lynx console

# Terminal 2: Expo example app for device testing.
pnpm start

# Terminal 3: after changing apps/expo-lynx-example/features/delivery.
# Builds, packages, and uploads. Then select and enable it in the console.
pnpm lynx release delivery
```

`pnpm lynx release delivery` generates an immutable release ID and a display
version automatically. It reads the local delivery API key from the ignored
`apps/console/.dev.vars` file and targets `http://127.0.0.1:8787` by default.
Use `--draft` to package without publishing. A changed embedded public key or
app endpoint requires a new native binary; a later `lynx release` does not.

## Publish the module and CLI

`expo-lynx-view` and `expo-lynx-bundle-cli` ship with the same version. The
commands below build and test both packages before npm sees either one.

```sh
# Change both package versions together, then review and commit the result.
pnpm release:prepare 0.3.1

# Runs lint, tests, builds, and npm pack previews. No npm publish happens here.
pnpm release:check

# Requires a clean, committed working tree, then publishes both public packages.
pnpm release:publish
```

Npm cannot atomically publish two packages. The script first confirms both
exact versions are free, fully checks both packages, then publishes
`expo-lynx-view` followed by `expo-lynx-bundle-cli`. If npm asks for two-factor
authentication, complete its prompt for each package.

## Set up a mini-app feature

The consuming Expo app owns `lynx-bundle.config.ts` (or `.mjs`). Feature keys
are canonical IDs: a `shopping` entry resolves to
`<featuresDir>/shopping`, so the feature ID and its project root are not
repeated in configuration.

```ts
import { defineConfig } from 'expo-lynx-bundle-cli';

export default defineConfig({
  appId: 'shop',
  featuresDir: './features',
  features: {
    shopping: {},
    orders: { entry: './src/main.tsx' },
  },
  // Kept outside Metro's imported asset graph so these resources are not
  // duplicated in the React Native JavaScript bundle.
  embeddedOutputDir: './generated/expo-lynx/embedded',
  releaseOutputDir: './dist/lynx-releases',
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

The CLI refuses to overwrite an existing pair. The Worker holds the private key
and signs its exact public deployment response with RSA-SHA256; the CLI never
receives that key. The mobile app verifies the response with the embedded public
key.

For the example, copy or replace the development public key at
`apps/expo-lynx-example/keys/lynx/updates.public.pem`, and keep the matching
private key only under the ignored `.local-lynx-keys/` directory. Configure the
public key and embedded resources in the Expo plugin:

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
            "shopping": "https://delivery.example.com/v1/shop/shopping"
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

## Release and delivery workflow

The embedded bundle remains the offline fallback. A remote release is a new
immutable `release.zip`; creating one does not rebuild React Native or iOS.
For local testing, start the Console and Expo app, then build/upload:

```sh
pnpm lynx console
pnpm start
pnpm lynx release delivery
```

`pnpm lynx bundle <feature>` calculates an Expo native fingerprint and writes
it to the embedded registry. `pnpm lynx release <feature>` reads that recorded
fingerprint; it never recalculates from a potentially changed working tree.
After a native dependency, plugin, Pod, Swift, Kotlin, or embedded-baseline
change, run `pnpm lynx bundle <feature>`, then deliberately prebuild and ship a
new host binary before uploading releases for that runtime.

For Cloudflare setup, release promotion, remote endpoint configuration, and
recovery, follow the [Delivery Console guide](./apps/console/README.md).

## Cloudflare delivery console and Worker

`apps/console` is the single TanStack Console and Elysia/Cloudflare Worker
package. The browser signs in with username/password, the CLI uploads through
its API key, and mobile reads only the public signed deployment route. See the
[Delivery Console guide](./apps/console/README.md) for local integration,
one-time Cloudflare deployment, mobile endpoint configuration, release upload,
promotion, rollback, and recovery.

## When an iOS prebuild is required

Run Expo prebuild and make a new native iOS build only when the native app
inputs change, for example:

- adding or removing an embedded feature;
- changing `embeddedBundlesPath`, `publicKeyPath`, or the configured delivery
  endpoint map;
- rotating the embedded public key; or
- updating the native module/plugin.

The embedded baseline also has a native runtime fingerprint. Rebuild after a
native or embedded-baseline change so the app and its remote releases keep the
same runtime identity.

Creating, signing, uploading, or switching to a new remote release does **not**
need prebuild or a new iOS binary. The app verifies the new signed release at
installation time and opens it on the next mini-app launch.

## First real-device remote test

1. Configure the app with the deployed HTTPS endpoint
   `https://<worker>.workers.dev/v1/<appId>/<feature>`, then run Expo prebuild
   and install one new native binary. The endpoint and public key are compiled
   into the app.
2. Build and upload a release, then select it and set `enabled: true` in the
   Console. Use `force: false` to apply it on the next feature open, or
   `force: true` to reload a mounted matching feature after verification.
3. A device that previously used a different Worker can retain a higher signed
   revision. Delete and reinstall it once only when moving between unrelated
   test Workers; normal production releases do not need reinstalling.

## Runtime-safe native updates

Each deployment is scoped by `(appId, feature, runtimeVersion)`. The app sends
its build-time fingerprint in `lynx-runtime-version`; the Worker returns only
that runtime's signed selection. An App Store update with a different
fingerprint therefore starts its new embedded baseline, never an incompatible
cached remote bundle. The console lets you select each compatible runtime
separately during an App Store rollout.

Older app binaries that do not send the header remain supported only while an
app/feature has one unambiguous deployment. Once multiple native runtimes are
active, those binaries fail closed and need an app update; they are never sent
another runtime's bundle.

For detailed iOS local testing and the delivery architecture, see
[`docs/ios-local-signed-lynx-testing.md`](./docs/ios-local-signed-lynx-testing.md)
and the package-level [delivery development guide](./packages/expo-lynx/feature/delivery-bundle-update/DEVELOPMENT.md).
