# W01 — Cloudflare Worker upload, deployment, and delivery

**Spec:** `feature/delivery-bundle-update/specs/v2/worker/w01-delivery-worker.md`

## Goal

Run the TanStack console, Elysia control API, D1 metadata, R2 upload/delivery,
and signed public deployment endpoint in one Cloudflare Worker.

The Worker accepts an authenticated unsigned release description from the CLI,
verifies one uploaded ZIP, stores minimal metadata in two tables, and signs the
exact plain JSON deployment response with its private key.

## Depends on

- [C01 — CLI build and upload](../cli/c01-release-build-upload.md).
- [M01 — Mobile verification and installation](../mobile/m01-shared-release-protocol.md).

## Owned files

- `apps/console/worker/`
- `apps/console/migrations/`
- `apps/console/src/features/delivery/`
- `apps/console/tests/`
- `apps/console/wrangler.toml` and local Worker documentation

## Ownership, users, and secrets

```text
users
  username + password hash authenticate the Console
  API-key hash authenticates the CLI upload endpoints

INITIAL_ADMIN_USERNAME, INITIAL_ADMIN_PASSWORD, INITIAL_ADMIN_API_KEY
  create the first enabled user only when users is empty

AUTH_SESSION_SECRET
  signs the Console's HTTP-only session cookie

R2 credentials
  remain in the CLI's ignored local environment and sign direct R2 PUTs

DELIVERY_SIGNING_PRIVATE_KEY
  remains a Worker secret and signs public deployment body bytes

delivery public key
  is embedded in mobile and is not secret
```

The browser receives no raw API key, R2 credential, or signing key. The CLI
receives its delivery API key plus local R2 S3 credentials; mobile receives no
user credential. The Worker holds the R2 bucket binding, not an R2 S3 key.

The signing key is PKCS#8 RSA PEM imported with the Worker Web Crypto API as
RSASSA-PKCS1-v1_5/SHA-256. The Worker must not use Node filesystem, `Buffer`,
Node `crypto`, process-global secret files, or unsupported native modules.

## One-shot remote setup

`pnpm lynx console setup --username <username>` is the explicit one-time
Cloudflare provisioning command. It must:

1. Follow Hot Updater's Cloudflare flow: read the existing Wrangler OAuth login
   to offer its Cloudflare accounts, or run `wrangler login` with account/user
   read plus D1/Workers write scopes. Prompt only for R2 S3 access-key ID and
   secret (secret hidden input), then verify the local signing private key
   matches the public key already embedded in the mobile app.
2. Create the configured D1 database and R2 bucket, then persist the D1 ID in
   `apps/console/wrangler.toml`.
3. Build and deploy the Worker, then record its `workers.dev` URL, D1 ID, R2
   bucket, generated Console password, and generated CLI API key in ignored
   root `.env.lynx`.
4. Put the first-user credentials, session secret, and signing private key into
   Worker secrets and apply remote D1 migrations.

It writes selected account and R2 credentials to ignored `.env.lynx`; the
Wrangler OAuth credential stays in Wrangler's credential store. It never writes
the signing private key there. It does not change the mobile endpoint because
that is a native build configuration decision. `--dry-run` validates
prerequisites without creating remote resources or writing files.

## D1 schema

There are exactly three tables. Validation belongs to Elysia controllers; the
migration has no business-rule `CHECK` constraints.

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE bundles (
  app_id TEXT NOT NULL,
  id TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  version TEXT NOT NULL,
  runtime_version TEXT NOT NULL,
  archive_sha256 TEXT NOT NULL,
  archive_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (app_id, id)
);

CREATE INDEX bundles_app_feature_created_at
  ON bundles (app_id, feature_id, created_at DESC);

CREATE TABLE deployments (
  app_id TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  bundle_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  force INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (app_id, feature_id)
);

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  api_key_hash TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
```

The Worker creates the first user only if `users` is empty and all three
`INITIAL_ADMIN_*` values are configured. It stores a salted password hash and
the API-key hash; it never stores or returns either raw credential. Restarting
the Worker never changes an existing user.

There is no stored envelope, signature, manifest hash, upload status, channel,
settings, audit, role, email, profile, patch, file, fingerprint, compatibility,
or metadata table.
A bundle row exists only after its ZIP is complete and verified.

R2 stores only:

```text
<appId>/<feature>/releases/<bundleId>/release.zip
```

Object keys are always constructed by the Worker from validated identifiers.

## Authentication and control API

The public mobile routes require no user authentication. Control authentication
happens before D1 work or deployment mutation:

```text
POST /api/auth/login      username + password -> HTTP-only session
POST /api/auth/logout     clears that session
GET  /api/auth/me         returns the signed-in username

GET   /api/deploy/:appId/:feature    requires Console session
PATCH /api/deploy/:appId/:feature    requires Console session
POST  /api/uploads            requires Bearer API key
POST  /api/uploads/:bundleId/complete
                              requires Bearer API key
```

The session cookie is HTTP-only and SameSite=Strict. It is `Secure` over HTTPS.
The API key is accepted only in `Authorization: Bearer <api-key>` and is never
accepted in a query string, cookie, or R2 upload request.

```text
GET   /api/deploy/:appId/:feature
PATCH /api/deploy/:appId/:feature
POST  /api/uploads
POST  /api/uploads/:bundleId/complete
```

`GET /api/deploy/:appId/:feature` returns the current deployment and recent registered
bundles for the console.

`PATCH /api/deploy/:appId/:feature` accepts exactly one operation:

```ts
type UpdateDeployment =
  | { enabled: boolean }
  | { bundleId: string; force: boolean };
```

- Selecting a bundle is promotion; selecting an older registered bundle is
  rollback.
- Promotion does not implicitly enable delivery.
- Enable/disable retains the selected bundle and resets `force` to false.
- Enabling requires a selected bundle.
- A changed bundle or enabled value increments `revision`.
- Selecting the current bundle with `force: false` is a no-op.
- Selecting any registered bundle with explicit `force: true`, including the
  current bundle, increments revision so mobile consumes one new reload request.
- Concurrent mutations use the prior revision as an optimistic condition. One
  succeeds; the loser returns `409` and cannot overwrite the newer state.

## Upload registration and completion

`POST /api/uploads` accepts the exact C01 `release.json` shape. It validates
identifiers, version/runtime strings, lowercase SHA-256, positive byte length,
and the 64 MiB archive ceiling. It returns `complete: true` for an identical
existing row, otherwise a pending canonical bundle ID. The CLI uploads to that
canonical R2 key with its own local S3 credential. Registration does not insert
D1 state.

`POST /api/uploads/:bundleId/complete` accepts the same metadata, requires route
and body ID equality, and verifies the canonical R2 object:

- object exists;
- byte length equals `archiveBytes`; and
- stored R2 SHA-256 equals `archiveSha256`.

If R2 does not expose the checksum in the local adapter, the Worker may read and
hash the object only after enforcing the 64 MiB bound. It must not buffer an
unbounded object.

Only then does it insert `bundles`. An identical completion retry returns the
existing row; the same ID with different feature, version, runtime, hash, or
bytes returns `409`. Failure creates no bundle row and cannot change deployment.

Local development may expose a same-origin PUT route backed by the local R2
binding when `LOCAL_UPLOADS=true`. It validates the same ZIP content type, byte
limit, and checksum header, is absent from production routing, and lets the CLI
run without production R2 S3 credentials. Completion remains the authority that
compares the stored object with authenticated release metadata before inserting
D1.

## Public API and signature

Only these delivery routes are public:

```text
GET /v1/:appId/:feature
GET /v1/:appId/:feature/:bundleId/release.zip
```

The Worker also accepts the old `/v1/deploy/:feature` and
`/v1/bundles/:feature/:bundleId/release.zip` paths as `default`-app
compatibility aliases. New Expo configuration uses the canonical scoped paths.

`GET /v1/:appId/:feature` builds the exact enabled or disabled JSON body defined
in the v2 index from the deployment and selected bundle rows. It serializes the
body once, signs those exact UTF-8 bytes, and returns the same bytes with:

```http
content-type: application/json; charset=utf-8
cache-control: no-store
lynx-signature: <unpadded-base64url-signature>
```

It never returns an unsigned `200`. Missing/invalid signing configuration
returns a safe `503`. A disabled deployment returns a signed `200`, not `204`.

The archive URL is the same-origin relative public route. That route requires a
matching registered bundle row, streams the canonical R2 object, sets ZIP
content type/length, and uses immutable caching plus a strong ETag. Uploading,
unknown, malformed, and unrelated keys are never public.

Public download authentication is intentionally absent. HTTPS protects
transport; the Worker signature authenticates deployment metadata; the signed
ZIP SHA-256 binds metadata to the exact executable archive.

## Console MVP

The existing `/` page consumes the control API and shows only:

- enabled/disabled state;
- selected bundle and revision;
- recent registered bundles;
- select/rollback with explicit force choice; and
- enable/disable.

The top selector changes the current `appId` and feature. It does not create
an app table; the pair is the namespace.

There is no browser upload, key management, channel selector, audit page,
bundle editor, delete action, or R2 credential UI.

## Errors and logging

Control errors use stable codes and safe messages for unauthenticated,
invalid-request, upload-not-configured, signing-not-configured,
upload-incomplete, checksum-mismatch, bundle-conflict, bundle-not-found,
deployment-empty, and deployment-conflict.

Logs and responses omit authorization headers, API keys, PEM content, R2
credentials, SQL text, stack traces, and ZIP content.

## Acceptance criteria

- [ ] Fresh local migration creates the three documented tables, including one
      enabled first user after configured bootstrap and first authentication.
- [ ] Console login succeeds only for an enabled user with the right password;
      its session accesses deployment routes but not upload routes.
- [ ] The same user's API key accesses upload routes but not deployment routes.
- [ ] CLI registration creates one pending canonical ZIP key and no D1 row.
- [ ] Completion verifies R2 size/SHA-256 before inserting one immutable bundle.
- [ ] Identical retries succeed; conflicting IDs fail without changing prior
      bundle or deployment state.
- [ ] No release public key, release envelope, release manifest object, stored
      deployment envelope, or per-file metadata remains in the Worker contract.
- [ ] Promotion, rollback, enable, disable, no-op, force, and concurrent conflict
      behavior match this spec and increment revision exactly when required.
- [ ] Enabled and disabled public bodies verify against one public key in
      TypeScript and the shared Swift fixture.
- [ ] A body-byte or signature mutation fails verification.
- [ ] Missing Worker signing key returns `503`; there is no unsigned fallback.
- [ ] Archive route streams only a registered canonical R2 object with immutable
      headers.
- [ ] Local CLI -> local upload -> completion -> promotion -> signed public fetch
      works without production R2 credentials and without a native build.
- [ ] Console/browser never receives a raw API key from the Worker, a signing
      private key, or R2 credentials.

## Required verification

```bash
pnpm --filter @expo-lynx/delivery-console typecheck
pnpm --filter @expo-lynx/delivery-console lint
pnpm --filter @expo-lynx/delivery-console test
pnpm --filter @expo-lynx/delivery-console build
git diff --check
```

Local integration must cover register -> PUT -> complete -> select force false
-> signed fetch -> select force true -> newer signed fetch -> disable -> signed
disabled fetch -> re-enable -> rollback. It must not deploy Cloudflare resources
or run native mobile builds.

## Out of scope

- DNS/custom domains, user-management UI, API-key rotation, roles, email
  verification, multiple environments, channels, cohorts, audit/history,
  browser upload, bundle deletion, deltas, multipart uploads, worker-side ZIP
  extraction, and Android implementation.
