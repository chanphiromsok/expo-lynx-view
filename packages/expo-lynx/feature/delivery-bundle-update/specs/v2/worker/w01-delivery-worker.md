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

## Ownership and secrets

```text
CONTROL_TOKEN
  authenticates console and CLI /api requests

R2 credentials
  remain Worker secrets and create short-lived object-specific PUT URLs

DELIVERY_SIGNING_PRIVATE_KEY
  remains a Worker secret and signs public deployment body bytes

delivery public key
  is embedded in mobile and is not secret
```

The browser receives none of these secrets. The CLI receives only a presigned
object-specific PUT URL and required upload headers. Mobile receives no token
or credential.

The signing key is PKCS#8 RSA PEM imported with the Worker Web Crypto API as
RSASSA-PKCS1-v1_5/SHA-256. The Worker must not use Node filesystem, `Buffer`,
Node `crypto`, process-global secret files, or unsupported native modules.

## D1 schema

There are exactly two tables and one list index. Validation belongs to Elysia
controllers; the migration has no business-rule `CHECK` constraints.

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE bundles (
  id TEXT PRIMARY KEY NOT NULL,
  feature_id TEXT NOT NULL,
  version TEXT NOT NULL,
  runtime_version TEXT NOT NULL,
  archive_sha256 TEXT NOT NULL,
  archive_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX bundles_feature_created_at
  ON bundles (feature_id, created_at DESC);

CREATE TABLE deployments (
  feature_id TEXT PRIMARY KEY NOT NULL,
  bundle_id TEXT REFERENCES bundles (id),
  enabled INTEGER NOT NULL DEFAULT 0,
  force INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
```

There is no stored envelope, signature, manifest hash, upload status, channel,
settings, audit, patch, file, fingerprint, compatibility, or metadata table.
A bundle row exists only after its ZIP is complete and verified.

R2 stores only:

```text
<feature>/releases/<bundleId>/release.zip
```

Object keys are always constructed by the Worker from validated identifiers.

## Control API

All `/api/*` routes require the control token before D1 work, R2 presigning, or
response signing.

```text
GET   /api/deploy/:feature
PATCH /api/deploy/:feature
POST  /api/uploads
POST  /api/uploads/:bundleId/complete
```

`GET /api/deploy/:feature` returns the current deployment and recent registered
bundles for the console.

`PATCH /api/deploy/:feature` accepts exactly one operation:

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
existing row or creates a 15-minute checksum-bound presigned R2 PUT for the
canonical key. Registration does not insert D1 state.

The upload instruction signs the object key, `application/zip`, and SHA-256
checksum header. It does not grant list, read, delete, another key, or permanent
bucket access.

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
binding because Miniflare cannot consume a production R2 presigned hostname.
That route is enabled only by local Worker configuration and loopback binding,
validates the same ZIP content type, byte limit, and checksum header, and is
absent from production routing. Completion remains the authority that compares
the stored object with the authenticated release metadata before inserting D1.

## Public API and signature

Only these delivery routes are public:

```text
GET /v1/deploy/:feature
GET /v1/bundles/:feature/:bundleId/release.zip
```

`GET /v1/deploy/:feature` builds the exact enabled or disabled JSON body defined
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

There is no browser upload, key management, channel selector, audit page,
bundle editor, delete action, or R2 credential UI.

## Errors and logging

Control errors use stable codes and safe messages for unauthenticated,
invalid-request, upload-not-configured, signing-not-configured,
upload-incomplete, checksum-mismatch, bundle-conflict, bundle-not-found,
deployment-empty, and deployment-conflict.

Logs and responses omit authorization headers, control tokens, PEM content, R2
credentials, presigned query strings, SQL text, stack traces, and ZIP content.

## Acceptance criteria

- [ ] Fresh local migration creates exactly the two documented tables and one
      index, matching the checked-in schema.
- [ ] CLI registration creates one checksum-bound ZIP PUT and no D1 row.
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
- [ ] Console/browser never receives a control token from the Worker, a signing
      private key, R2 credentials, or a CLI presigned URL.

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

- Production deployment, DNS, secret creation/rotation, multiple environments,
  channels, cohorts, audit/history, browser upload, bundle deletion, deltas,
  multipart uploads, worker-side ZIP extraction, and Android implementation.
