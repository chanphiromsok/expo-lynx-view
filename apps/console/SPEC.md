# C01 — Minimal bundle deployment console and Worker

**Spec:** `apps/console/SPEC.md`

## Goal

Ship one Cloudflare Worker containing the TanStack console, Elysia API, D1
metadata, and R2 delivery routes. A trusted CLI signs and uploads immutable
Lynx bundles; the console can select one bundle for a feature and enable or
disable remote delivery.

This milestone replaces the unshipped channel/revision/audit schema with two
tables: `bundles` and `deployments`. There is one deployment per feature and no
stable, beta, production, or active channel row.

## Depends on

- [M01 — Shared release and deployment protocol](../../packages/expo-lynx/feature/delivery-bundle-update/specs/v2/mobile/m01-shared-release-protocol.md).
- [M04 — Mobile deployment check and fallback](../../packages/expo-lynx/feature/delivery-bundle-update/specs/v2/mobile/m04-update-check-activation-recovery.md).
- The existing trusted CLI release signing flow.
- The existing `apps/console` Worker, D1, and R2 bindings.

## Files

- `apps/console/migrations/0001_delivery_schema.sql`
- `apps/console/worker/db/schema.ts`
- `apps/console/worker/index.ts`
- `apps/console/worker/public-delivery.ts`
- `apps/console/src/features/delivery/delivery-api.ts`
- `apps/console/src/features/delivery/DeliveryConsoleDashboard.tsx`
- `apps/console/tests/public-delivery.test.ts`
- focused console, Worker, D1, and R2 tests

## Contract

### Ownership

```text
CLI
  build + sign release + request upload + upload directly to R2 + complete

Console
  view selected bundle + enable/disable + promote/rollback

Worker
  validate requests + verify signed release + presign R2 + verify uploaded
  objects + insert bundle + sign deployment + update D1 + serve public data
```

The browser never builds, signs, or uploads a bundle. It never receives an R2
credential, Cloudflare management token, or private signing key.

### D1 schema

Only verified bundles are inserted. A bundle row therefore means ready; there
is no `uploading`, `ready`, `rejected`, or other stored bundle status.

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE bundles (
  id TEXT PRIMARY KEY NOT NULL,
  feature_id TEXT NOT NULL,
  version TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  manifest_bytes INTEGER NOT NULL,
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
  envelope_text TEXT,
  envelope_sha256 TEXT,
  updated_at TEXT NOT NULL
);
```

The schema uses only structural keys, required columns, defaults, and one list
index; it has no database `CHECK` validation. Elysia controller schemas validate
request identifiers, hashes, sizes, booleans, and signed-envelope shapes.
Application code enforces business rules such as selecting only an existing
bundle.

R2 keys are derived, never accepted from a client or stored in D1:

```text
<feature>/releases/<bundleId>/manifest.json
<feature>/releases/<bundleId>/release.zip
```

Release compatibility, platform, expanded size, entry count, and exact files
remain in the signed release manifest in R2 rather than being duplicated in
D1.

### API routes

The same Worker exposes these authenticated console and CLI routes:

```text
GET   /api/deploy/:feature
PATCH /api/deploy/:feature
POST  /api/uploads
POST  /api/uploads/:bundleId/complete
```

`GET /api/deploy/:feature` returns the deployment and recent bundles.

`PATCH /api/deploy/:feature` accepts exactly one operation:

```ts
type UpdateDeployment =
  | { enabled: boolean }
  | { bundleId: string; force: boolean };
```

Changing `bundleId` is promotion. Selecting an older bundle is rollback. Every
promotion explicitly chooses `force`; there is no separate activation field.
Promotion does not change `enabled`. Enabling or disabling does not change
`bundleId` and resets the stored force instruction to false. Repeating the
current enabled value returns the current deployment without a new revision. A
different bundle or any `force: true` request creates a new revision; selecting
the current bundle with `force: false` is a no-op.

`POST /api/uploads` validates the signed release envelope and returns
short-lived presigned R2 `PUT` URLs for its canonical manifest and ZIP keys. It
does not write D1.

After both uploads, `POST /api/uploads/:bundleId/complete` receives the signed
release envelope again. The Worker verifies the signature, route/payload
identity, R2 object existence, byte sizes, and SHA-256 values. It inserts the
bundle only after every check succeeds. Failure returns a safe error and leaves
no bundle row.

An identical completion retry returns the existing bundle. Reusing a bundle ID
with different signed identity, hashes, or sizes returns conflict.

### Public routes

```text
GET /v1/deploy/:feature
GET /v1/bundles/:feature/:bundleId/manifest
GET /v1/bundles/:feature/:bundleId/release.zip
```

The deployment route returns an exact signed deployment envelope. Manifest and
ZIP routes require a matching bundle row and stream only the canonical R2
object associated with that row.

Manifest and ZIP responses use immutable caching and strong ETags. Deployment
responses revalidate and use `envelope_sha256` as the strong ETag.

### Signed deployment state

The Worker constructs and signs the exact `lynx-deployment` enabled or disabled
payload defined by M01. A signed disabled deployment returns HTTP `200`, not
`204`, so the response authenticates both `enabled: false` and its revision.
M04 exclusively owns mobile persistence, local source retention, application
timing, offline behavior, and replay protection.

### Display status

Status is derived and is not a D1 bundle column:

```text
deployment enabled + selected bundle -> active
deployment disabled                  -> delivery disabled; local installs stay
deployment enabled + no bundle       -> empty
unselected bundle row                -> ready
```

The console needs one `/` screen: deployment enabled state, selected bundle,
revision, recent verified bundles, and a confirmation before promotion or
rollback. There is no browser upload control, audit page, channel selector, or
release-detail page in this milestone.

## Requirements

- Validate all authenticated request bodies and route parameters in Elysia
  controller schemas before D1 queries or R2 key construction.
- Authenticate console and CLI routes; leave only `/v1/*` and health public.
- Construct all R2 keys in the Worker from verified feature and bundle IDs.
- Keep archive bytes out of the Worker request body; the CLI uploads directly
  to presigned R2 URLs.
- Verify signed manifest and uploaded R2 bytes before inserting `bundles`.
- Make bundle completion safe for identical retries and conflicting IDs.
- Update bundle selection, enabled value, force instruction, revision, exact
  signed envelope, envelope hash, and timestamp in one D1 transaction.
- Increment revision when the selected bundle or enabled value changes, or an
  explicit `force: true` instruction is accepted.
- Reject `enabled: true` when the deployment has no selected bundle.
- Never change `enabled` implicitly during upload, promotion, or rollback.
- Do not duplicate release-manifest fields in D1 unless a measured query
  requirement is added to this spec first.

## Acceptance criteria

- [ ] A fresh local migration creates exactly `bundles` and `deployments`, plus
      the single bundle-list index.
- [ ] The checked-in Drizzle schema and SQL migration describe the same columns,
      keys, defaults, relation, and index without DB `CHECK` constraints.
- [ ] A valid signed release receives canonical presigned R2 URLs; registration
      creates no D1 row.
- [ ] Successful completion verifies both R2 objects and inserts one bundle.
- [ ] Wrong signature, feature, ID, hash, size, missing object, or conflicting
      retry creates no bundle and cannot affect the deployment.
- [ ] Identical completion retry returns the existing bundle without a second
      row.
- [ ] Promotion selects an existing bundle and increments deployment revision
      without changing `enabled`.
- [ ] `force: false` and `force: true` round-trip in enabled signed deployment
      envelopes without a separate activation field.
- [ ] Selecting the current bundle with `force: true` creates a newer revision;
      selecting it with `force: false` is a no-op.
- [ ] Rollback selects an older existing bundle with a newer revision.
- [ ] Enable and disable keep the selected bundle and each increments revision.
- [ ] Repeating the current enabled value returns the current deployment
      without incrementing revision.
- [ ] Public deployment bytes equal the stored signed envelope bytes; ETag and
      `304` behavior use the stored envelope hash.
- [ ] The browser receives no private signing key, R2 credential, Cloudflare
      management token, or presigned URL intended for another release.

## Required verification

```bash
pnpm --filter @expo-lynx/delivery-console typecheck
pnpm --filter @expo-lynx/delivery-console lint
pnpm --filter @expo-lynx/delivery-console test
pnpm --filter @expo-lynx/delivery-console build
git diff --check
```

Local integration evidence must cover:

```text
sign -> presign -> direct R2 upload -> complete -> insert bundle
     -> promote force=false -> fetch signed enabled deployment
     -> promote force=true -> newer signed force deployment
     -> disable -> fetch signed disabled deployment
     -> re-enable -> fetch signed enabled deployment for retained bundle
     -> select older bundle -> rollback revision increases
```

## Out of scope

- Multiple channels, environments within one database, or percentage rollout.
- Uploading/rejected rows, upload progress, temporary D1 upload state, or an
  upload-history screen.
- Append-only deployment history, audit events, idempotency tables, actor
  history, or approval workflows.
- Browser build, signing, upload, editing, deletion, or R2 browsing.
- Differential patches, asset-base tables, arbitrary metadata, compatibility
  query columns, signing-key fingerprints, or settings tables.
- Mobile implementation, which is owned by M01 and M04.
