# Expo Lynx Delivery Console

The single package for the Expo Lynx delivery console and its Cloudflare
Worker. Its `dev` command starts Vite's TanStack Router/Query single-page app
with HMR alongside the local Elysia Worker; the same package builds and deploys
the console assets, public delivery routes, D1 schema, and R2 bindings as one
Worker.

Review [SPEC.md](./SPEC.md) before work starts. It links the authoritative
three-part v2 contract for the CLI, Worker, and mobile client.

Start it from the repository root. This is the phone-friendly command: it runs
the Worker on your LAN and keeps the browser console on the Mac.

```sh
pnpm lynx console
```

The console is intentionally separate from `apps/docs`: documentation is
content-facing; this app is the operational workspace for release inspection,
promotion, rollback, and delivery enablement. The trusted CLI signs and uploads
archives directly to R2 using its local credential.

## How the pieces fit

| Part | Owns | Never receives |
| --- | --- | --- |
| Mobile app | Embedded fallback bundle and delivery public key | Console login, CLI API key, R2 credential, private key |
| `pnpm lynx release delivery` | Build, ZIP, SHA-256, and direct R2 upload | Delivery private key |
| Console | Bundle selection, `enabled`, and `force` | CLI API key, R2 credential, private key |
| Worker | D1 state, ZIP verification, signed mobile response | CLI R2 credential |

The flow is: **CLI uploads a verified bundle → Console selects it → Worker
signs the selected deployment → mobile verifies and installs it**. One Worker
serves every app: each deployment is identified by
`(appId, feature, runtimeVersion)`. There are no channels, environments, or
rollout groups in this MVP.

## Development

```sh
# React console with HMR plus the local Cloudflare Worker on port 8787.
pnpm lynx console

# Public Worker route contract, without Wrangler or a native build.
pnpm --filter @expo-lynx/delivery-console test

# D1's checked-in v2 schema, applied only to local Worker state.
pnpm --filter @expo-lynx/delivery-console db:migrate:local
```

The console deliberately persists the new local D1 and R2 state in
`.wrangler/delivery-worker-v2`, separate from earlier local schemas. Existing
local state is not deleted or migrated automatically; the new directory starts
with the delivery schema plus the one no-role `users` table.

Before opening the local console, choose one local username and password, then
generate a delivery API key for the CLI and a random session-signing secret:

```sh
cd apps/console
openssl rand -base64 32 # run twice: one API key and one session secret
```

Copy the values into the ignored `apps/console/.dev.vars` file:

```dotenv
INITIAL_ADMIN_USERNAME="phirom"
INITIAL_ADMIN_PASSWORD="choose-a-local-password"
INITIAL_ADMIN_API_KEY="lynx_live_paste-the-generated-api-key-here"
AUTH_SESSION_SECRET="paste-a-different-random-value-here"
LOCAL_UPLOADS="true"
```

Restart `pnpm lynx console`, then sign into the console with the username and
password. The Worker creates the one initial user only when the `users` table
is empty. Remote setup configures the equivalent Worker secrets; after the
first successful login, keep the bootstrap values only in your deployment
secret store. `LOCAL_UPLOADS=true` enables a short-lived same-origin PUT
capability only on loopback local development; do not configure it in
production.

The public deployment route also needs the one Worker-only signing secret:

```sh
wrangler secret put DELIVERY_SIGNING_PRIVATE_KEY
```

It must be a PKCS#8 RSA private-key PEM whose matching public key is embedded
in the mobile app. The CLI does not receive this key. In production the CLI
holds the R2 S3 credential locally, signs its own archive PUT, and never sends
its delivery API key to R2.

For `pnpm lynx console setup`, place that PEM in the ignored
`apps/console/.dev.vars` file as `DELIVERY_SIGNING_PRIVATE_KEY`. Keep the PEM
header, body, and footer intact; setup reads it locally, verifies it matches
the mobile public key, and sends it directly to the Worker secret store.

## First remote deployment

This is the complete one-time setup for a new Cloudflare account.

1. Ensure `apps/console/.dev.vars` contains `DELIVERY_SIGNING_PRIVATE_KEY`.
   Its public half must already be the file configured by the Expo plugin (the
   example uses `apps/expo-lynx-example/keys/lynx/updates.public.pem`). Setup
   refuses a mismatched pair.
2. Create an R2 S3 API credential with **Object Read & Write**. If
   `lynx-artifacts` already exists, scope it to that bucket. Setup stores this
   credential only in your ignored local `.env.lynx`; the Worker does not use it.
3. Run setup:

```sh
pnpm lynx console setup --username <your-console-username>
```

Setup follows Hot Updater's Cloudflare flow: it uses the existing Wrangler OAuth
login to show an account list (and opens `wrangler login` when needed), then
asks for the R2 access-key ID and secret. OAuth requests account/user read plus
D1/Workers write. Setup creates or reuses configured D1/R2 resources, deploys
the Worker, sets Worker secrets, migrates D1, and writes ignored root
`.env.lynx`.

4. Keep `.env.lynx` private. It contains the generated Console password, CLI
   API key, R2 credential, Worker URL, and Cloudflare account ID. It is ignored
   by Git and is the only file needed for later CLI releases.
5. Point the native Expo plugin at the deployed public route:

```json
{
  "deliveryEndpoints": {
    "delivery": "https://your-worker.workers.dev/v1/default/delivery"
  }
}
```

The endpoint and embedded public key are native build inputs. Make a new app
binary after changing either one. Uploading or promoting later releases does
not need a native build.

### First real-device release

After installing that binary, run the release command above, then select the
verified bundle and set `enabled: true` in the Console. Use `force: false` for
the next feature open or `force: true` to reload a mounted matching feature
after download and verification complete.

If the device previously tested a different Worker, such as a LAN Worker, and
reports `ERR_LYNX_DEPLOYMENT_REPLAY`, delete and reinstall the app once. That
clears the old Worker’s recorded revision and installed remote bundle. Later
production releases only need upload and a Console state change.

### Native runtime rollout

The CLI stores an Expo fingerprint in the embedded registry when it builds the
baseline. The app sends that value as `lynx-runtime-version` on every public
deployment check. The Console shows one app / mini-app / runtime scope and
cannot select a bundle built for another native runtime.

When native inputs change, run `pnpm lynx bundle <feature>`, deliberately
prebuild and ship the new host app, then upload a release for its new
fingerprint. Keep the prior runtime's deployment selected while that App Store
version remains installed.

Pre-runtime-header app versions are accepted only while their app/feature has
one unambiguous deployment. Once two runtime rows exist, the Worker returns
`legacy-runtime-ambiguous` rather than risk an incompatible remote bundle.

Review local prerequisites without changing Cloudflare or local files:

```sh
pnpm lynx console setup --username phirom --dry-run
```

## First remote release

Load the generated Worker URL and CLI API key, then build and upload the
feature:

```sh
set -a
source .env.lynx
set +a
pnpm lynx release delivery
```

The CLI builds a release directory, signs and uploads `release.zip` directly to
R2, and asks the Worker to verify it. It does **not** enable the release.

Open the Worker URL in a browser, sign in with `LYNX_DELIVERY_USERNAME` and
`LYNX_DELIVERY_PASSWORD` from `.env.lynx`, select the verified bundle, and set
its delivery state:

- `enabled: true`, `force: false`: stage the verified release for the next
  feature open.
- `enabled: true`, `force: true`: reload a mounted matching feature only after
  download, verification, and installation succeed. It is polling, not server
  push.
- `enabled: false`: stop new downloads. It does not delete or deactivate a
  release already verified on a device; devices without one use embedded.

Deploy a later Console/Worker code change with:

```sh
pnpm --filter @expo-lynx/delivery-console run deploy
```

Use `run deploy`, not `pnpm --filter … deploy`; the latter is pnpm's separate
workspace packaging command.

## Use a separate Lynx app repository

An app outside this monorepo needs the delivery Worker URL, its CLI API key,
and the R2 S3 credential for the delivery bucket. It does not need the Console
source, Cloudflare login, Console password, or delivery private key.

`@expo-lynx/bundle-cli` is currently private, so link the local package while
developing it:

```sh
cd ~/Desktop/my-lynx-app
pnpm add -D /Users/phirom/Desktop/expo-lynx-monorepo/packages/lynx-bundle-cli
```

After it is published, replace that command with:

```sh
pnpm add -D @expo-lynx/bundle-cli
```

The app needs a `lynx-bundle.config.mjs` file. This is the smallest shape:

```js
export default {
  appId: 'shop',
  featuresDir: './features',
  features: { delivery: {} },
  releaseOutputDir: './dist/lynx-releases',
};
```

Keep these values in that app's ignored `.env.lynx.local` file; copy them from
the Console deployment's `.env.lynx`:

```dotenv
LYNX_DELIVERY_SERVER="https://your-worker.workers.dev"
LYNX_DELIVERY_API_KEY="lynx_live_your-upload-key"
CLOUDFLARE_ACCOUNT_ID="your-cloudflare-account-id"
LYNX_DELIVERY_R2_BUCKET="lynx-artifacts"
R2_ACCESS_KEY_ID="your-r2-access-key-id"
R2_SECRET_ACCESS_KEY="your-r2-secret-access-key"
```

Build/package the Lynx feature, then upload the resulting directory:

```sh
set -a
source .env.lynx.local
set +a

release_id="delivery-20260904-01"
version="2026.09.04"

pnpm exec lynx-bundle pack delivery \
  --release-id "$release_id" \
  --version "$version" \
  --platform ios \
  --runtime-version expo-57

pnpm exec lynx release:upload \
  "./dist/lynx-releases/delivery/$release_id"
```

`appId` is the Worker namespace for this host app. Give every host app a
different lowercase identifier (`shop`, `merchant`, and so on); features may
then reuse names safely. The mobile endpoint for `shop`'s `delivery` feature
is `https://your-worker.workers.dev/v1/shop/delivery`. Open that deployment in
the Console at `/?app=shop&feature=delivery`.

`lynx-bundle pack` runs the Rspeedy production build and creates
`release.json` plus `release.zip`. `lynx release:upload` signs and uploads only
the ZIP to R2, then registers it. Open the Console to select and enable the
verified bundle.

### Remote setup recovery

- `A database with that name already exists`: run `wrangler d1 list --json`,
  put the matching UUID in `apps/console/wrangler.toml`, then rerun setup.
- `A bucket already exists`: setup reuses the configured `lynx-artifacts`
  bucket on the next run.
- Mobile gets no update: confirm its compiled endpoint is the HTTPS
  `…/v1/<appId>/<feature>` URL, not the Console root or an old LAN address.
- Console login fails after a Worker code change: deploy the current Worker;
  bootstrap creates the first user only when the `users` table is empty.

## Current scope

The `/` screen uses same-origin Worker control routes, not mock data. It signs
in with username and password and holds an HTTP-only session cookie. The screen
can inspect verified bundles, select a bundle, explicitly request a forced
reload, and enable or disable remote delivery. TanStack Query owns the one
deployment overview cache and updates it only after the Worker mutation
succeeds.

The browser never receives Cloudflare credentials or the Worker private key.
The CLI produces unsigned local `release.json` metadata plus `release.zip`;
the Worker verifies the ZIP after direct R2 upload and signs the public
deployment response when a device fetches it.

## Testing Local

Use three terminals from the repository root:

```sh
# Terminal 1 — Worker + browser console. It prints the current LAN URL.
pnpm lynx console

# Terminal 2 — Expo example for the iPhone.
pnpm start

# Terminal 3 — after editing features/delivery, build and upload a new bundle.
pnpm lynx release delivery
```

The release command reads `INITIAL_ADMIN_API_KEY` from the ignored
`apps/console/.dev.vars` file and sends it only to `http://127.0.0.1:8787`.
It never uploads the API key to R2. Open the browser console URL, sign in,
select the new verified bundle, then enable delivery.

For a physical phone, copy the LAN address printed by Terminal 1 into the
example app's `deliveryEndpoints.delivery` value. The endpoint change is
native build configuration; it needs a new app binary only when that address
or the embedded public key changes—not for each release.
