# iOS managed Lynx delivery testing

This is the practical local test loop for the same Worker contract used in
Cloudflare. It does not start an iOS build.

## One-time native setup

Set the Expo plugin to the production Worker endpoint and public verification
key:

```json
[
  "expo-lynx-view",
  {
    "embeddedBundlesPath": "./generated/expo-lynx/embedded",
    "publicKeyPath": "./keys/lynx/updates.public.pem",
    "deliveryEndpoints": {
      "delivery": "https://your-worker.workers.dev/v1/default/delivery"
    }
  }
]
```

Build an embedded baseline before deliberately prebuilding a new native binary:

```sh
pnpm lynx bundle delivery
npx expo prebuild --platform ios
```

`bundle` records an Expo native fingerprint in the embedded registry. The
native app sends that fingerprint as `lynx-runtime-version`, so it can receive
only a selected bundle compiled for the same native runtime.

## Local Worker and iPhone

Start the local Console/Worker from the monorepo root:

```sh
pnpm lynx console
```

For a physical phone, compile your Mac's LAN address into the endpoint map:

```text
http://192.168.1.20:8787/v1/default/delivery
```

The phone and Mac must be on the same Wi-Fi. `localhost` refers to the phone,
not the Mac. HTTP is allowed only in an internal Release build compiled with
`LYNX_ALLOW_LOCAL_MANAGED_RELEASE=1`; deployed builds use HTTPS.

## Test a remote update

In another terminal, start the host app and create a release:

```sh
pnpm start
pnpm lynx release delivery
```

The CLI builds the feature, packages `release.zip`, uploads it with the local
R2 credential, and registers it with the Worker. It does not automatically
make it live. In the Console, select the uploaded bundle under the exact
`appId / feature / runtimeVersion` scope and set `enabled: true`.

```text
embedded baseline or compatible cache
  → Worker checks signed deployment in background
  → verified ZIP installs atomically
  → force false: next feature open
  → force true: reload mounted matching feature
```

Set `enabled: false` to stop new downloads. A compatible device that already
verified the remote bundle keeps its local cache and still opens it; a clean
device uses its embedded baseline.

## What to inspect

For local D1/R2 state, inspect the newest SQLite file below:

```text
apps/console/.wrangler/delivery-worker-v2
```

Wrangler owns the exact filename; TablePlus can open that SQLite database. The
three useful tables are `bundles`, `deployments`, and `users`.

For iOS first-render measurements, IFR logging is present in Debug builds. To
measure an internal Release build, run `LYNX_IFR_METRICS=1 pod install` from
`apps/expo-lynx-example/ios` before building it. Normal Release builds omit the
logger entirely.

```sh
xcrun simctl spawn booted log stream \
  --style compact \
  --level info \
  --predicate 'subsystem == "expo.lynx.view" AND category == "IFR"'
```

`first_screen_ms` measures from selected local source to Lynx first screen;
`delivery_start_ms` shows when background deployment work began. Neither should
delay the initial embedded/cache render.
