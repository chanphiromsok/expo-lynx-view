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
promotion, rollback, and delivery enablement. The trusted CLI uploads archives
directly to R2 with a Worker-issued presigned URL.

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
with the exact two-table schema in `migrations/0001_delivery_schema.sql`.

Before opening the local console, create one local control credential. It is an
application-specific admin token, not a Cloudflare API token or R2 key:

```sh
cd apps/console
openssl rand -base64 32
```

Copy the generated value into the ignored `apps/console/.dev.vars` file:

```dotenv
CONTROL_TOKEN="paste-the-generated-value-here"
LOCAL_UPLOADS="true"
```

Restart `pnpm lynx console`, then paste the same value into the console's
connection screen. Use `wrangler secret put CONTROL_TOKEN` to configure a
different production secret before deployment. `LOCAL_UPLOADS=true` enables a
short-lived same-origin PUT capability only on loopback local development; do
not configure it in production.

The public deployment route also needs the one Worker-only signing secret:

```sh
wrangler secret put DELIVERY_SIGNING_PRIVATE_KEY
```

It must be a PKCS#8 RSA private-key PEM whose matching public key is embedded
in the mobile app. The CLI does not receive this key. In production the CLI
instead receives a checksum-bound R2 presigned PUT URL; it has no R2
credentials and never sends the control token to that URL.

`pnpm --filter @expo-lynx/delivery-console deploy` first builds the Vite app,
then deploys the Elysia Worker and its static assets together. Replace the
placeholder D1 ID in `wrangler.toml` only after intentionally provisioning the
remote D1 database.

## Current scope

The `/` screen uses same-origin Worker control routes, not mock data. It asks
for `CONTROL_TOKEN` once and keeps it in browser memory only, so the token is
lost when the page refreshes. The screen can inspect verified bundles, select
a bundle, explicitly request a forced reload, and enable or disable remote
delivery. TanStack Query owns the one deployment overview cache and updates it
only after the Worker mutation succeeds.

The browser never receives Cloudflare credentials, the Worker private key, or
an upload URL. The CLI produces unsigned local `release.json` metadata plus
`release.zip`; the Worker verifies the ZIP after direct R2 upload and signs
the public deployment response when a device fetches it.

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

The release command reads `CONTROL_TOKEN` from the ignored
`apps/console/.dev.vars` file and sends it only to `http://127.0.0.1:8787`.
It never uploads the token to R2. Open the browser console URL, enter the same
control token, select the new verified bundle, then enable delivery.

For a physical phone, copy the LAN address printed by Terminal 1 into the
example app's `deliveryEndpoints.delivery` value. The endpoint change is
native build configuration; it needs a new app binary only when that address
or the embedded public key changes—not for each release.
