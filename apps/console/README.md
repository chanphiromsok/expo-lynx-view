# Expo Lynx Delivery Console

The single package for the Expo Lynx delivery console and its Cloudflare
Worker. Its `dev` command starts Vite's TanStack Router/Query single-page app
with HMR alongside the local Elysia Worker; the same package builds and deploys
the console assets, public delivery routes, D1 schema, and R2 bindings as one
Worker.

Review the small implementation contract in [SPEC.md](./SPEC.md) before work
starts. The broader production scope, milestones, launch gates, and deferred
work are defined in [MVP.md](./MVP.md).

Start it from the repository root:

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

# D1's checked-in initial schema, applied only to local Worker state.
pnpm --filter @expo-lynx/delivery-console db:migrate:local
```

The console deliberately persists v2 local D1 and R2 state in
`.wrangler/delivery-v2`, separate from the retired channel-based local schema.
This keeps old local test data intact while a new local database is initialized
from `migrations/0001_delivery_schema.sql`.

Before opening the local console, create one local control credential. It is an
application-specific admin token, not a Cloudflare API token or R2 key:

```sh
cd apps/console
openssl rand -base64 32
```

Copy the generated value into the ignored `apps/console/.dev.vars` file:

```dotenv
CONTROL_TOKEN="paste-the-generated-value-here"
```

Restart `pnpm lynx console`, then paste the same value into the console's
connection screen. Use `wrangler secret put CONTROL_TOKEN` to configure a
different production secret before deployment.

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

The browser never receives Cloudflare credentials or either signing key. The
deployed Worker uses its D1/R2 bindings directly; releases remain signed by a
trusted local or CI workflow before upload.

Copy the repository template before connecting the Cloudflare adapter:

```sh
cp .env.lynx-delivery.example .env.lynx-delivery
```

The real file is ignored by Git. It contains the Cloudflare API token/account
details, R2 bucket and scoped S3 access keys, D1 database ID, Worker name, and
the local public verification-key path.
