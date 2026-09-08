# `expo-lynx-bundle-cli`

The CLI prepares a host runtime and publishes an isolated mini app. It creates
one deterministic ZIP, signs its R2 request locally, and asks the delivery
Worker to verify it. It does not sign mobile deployments or read the Worker's
RSA private key.

## Copyable configuration examples

- [Expo host `app.json`](./examples/host-app/app.json)
- [Independent mini-app `lynx-miniapp.config.ts`](./examples/mini-app/lynx-miniapp.config.ts)

The host owns `embeddedBundlesPath`, the public trust key, and the public
delivery endpoint. A mini app owns only its `appId` and `feature`; it does not
copy host runtime values into its source repository.

## Deploy the Console from a host app

The Console is deployed by the host app owner, not by this library repository.
The published CLI includes the Worker, web Console, and D1 migrations.

```sh
# Run in the Expo host app.
lynx keys generate
lynx console setup
```

The first command creates an ignored `.env.lynx` template. Set the Worker, D1,
and R2 names; a Console username/password; and an R2 S3 Object Read & Write
credential. Run `lynx console setup` a second time to authorize Cloudflare in
the browser and provision the infrastructure. It writes the Worker URL and
release API key back to `.env.lynx`; never commit that file or copy the private
key to a mini-app repository. Run `lynx console deploy` for later Worker/UI
updates without replacing D1 data or Worker secrets.

```sh
# Expo host repository
lynx keys generate
lynx doctor --platform ios
lynx host embed ../mart --platform ios
lynx host prepare --platform ios
lynx host register --platform ios
lynx doctor --platform android
lynx host embed ../mart --platform android
lynx host prepare --platform android
lynx host register --platform android

# independent mini-app repository
lynx doctor
lynx release --platform ios
```

## Release workflow

```sh
export LYNX_DELIVERY_SERVER="http://127.0.0.1:8787"
export LYNX_DELIVERY_API_KEY="<local-delivery-api-key>"

# Build, package, upload the ZIP, and ask the Worker to verify and register it.
pnpm exec lynx release --platform ios

# Build only. This performs no network request.
pnpm exec lynx release --platform ios --draft
```

For a manual terminal release, the CLI shows the Worker's current host build
and asks for confirmation. `--host-build` (or `LYNX_EXPECTED_HOST_BUILD`) is
needed only for non-interactive CI, where it fails closed if the host team has
registered a different build.

The draft output contains exactly two files:

```text
dist/lynx-releases/<feature>/<releaseId>/
  release.json
  release.zip
```

`release.json` is local, unsigned upload metadata. It is never served to
mobile and is never stored in R2:

```json
{
  "schemaVersion": 2,
  "appId": "bs-one",
  "feature": "merchant-home",
  "releaseId": "merchant-home-20260906T101930455Z",
  "version": "2026.09.01",
  "platform": "ios",
  "archiveSha256": "9da2223840940f013b8ffa763b4a1dde4959c8647cee8a9c1b465d16b7dd692f",
  "archiveBytes": 344959
}
```

The command sends this exact metadata to the authenticated Worker upload API,
uploads only `release.zip` directly to R2, then calls completion. The Worker
validates the R2 object's exact SHA-256 and byte length before inserting an
immutable bundle. Production upload requires `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID` (or `CLOUDFLARE_ACCOUNT_ID`), and
`R2_BUCKET_NAME` (or `LYNX_DELIVERY_R2_BUCKET`). Local Worker mode needs none
of these because it uses its local R2 binding.

The Worker assigns the mini-app release to the currently registered host
runtime for its app and platform. The mini-app never supplies a host
fingerprint. The host team runs `lynx host prepare` then `lynx host register`
when deliberately preparing a new native build.

Before host preparation, build the offline embedded fallback from every
independent mini-app repository:

```sh
# Run from the Expo host repository.
lynx host embed ../mart --platform ios
lynx host prepare --platform ios
# Repeat both commands with --platform android before an Android native build.
```

`host embed` reads the mini app's `lynx-miniapp.config.ts`, confirms that its
app and feature match the host's configured endpoint, runs its production
Rspeedy build, and writes the permitted runtime files to the host's configured
`embeddedBundlesPath`.

To retry an already-built draft:

```sh
pnpm lynx release upload \
  ./dist/lynx-releases/delivery/delivery-20260901T011848990Z-ac8c0e
```

`--server` and `--api-key` override the two environment variables. `--json`
prints the registered bundle record. The command never selects a bundle,
enables delivery, or requests force reload; make those choices in the console.

## Configuration

An independent mini app uses `lynx-miniapp.config.ts`. It has no signing-key
or host-runtime configuration.

```ts
import { defineMiniApp } from 'expo-lynx-bundle-cli';

export default defineMiniApp({
  appId: 'bs-one',
  feature: 'merchant-home',
});
```

The accepted runtime output is exactly `main.lynx.bundle` plus `static/**`
sidecars. The packer rejects unsafe paths, links, unexpected files, and ZIPs
over the mobile archive limits before any upload is attempted. Release
packaging and managed delivery support both `ios` and `android`; register each
platform separately because their native runtime fingerprints differ.

See the [delivery console guide](../../apps/console/README.md) for Cloudflare
setup, credentials, local D1/R2 testing, and console promotion.
