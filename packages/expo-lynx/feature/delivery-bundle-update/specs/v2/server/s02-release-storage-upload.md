# S02 — D1 release storage and authenticated immutable R2 publication

**Spec:** `feature/delivery-bundle-update/specs/v2/server/s02-release-storage-upload.md`

## Goal

Implement the release persistence model and authenticated upload transaction as
one unit: validate a signed S01 release, write immutable manifest/ZIP objects to
R2, read them back, and mark the D1 release ready only after verified storage.

## Why these tasks are merged

The schema exists to enforce publication invariants. Implementing tables without
the upload transaction made readiness, immutability, retries, and failure states
ambiguous. This spec defines and tests those rules together.

## Depends on

- [M01 — Shared release protocol](../mobile/m01-shared-release-protocol.md).
- [S01 — Build, package, and signing CLI](s01-build-package-sign.md).
- Existing Worker, D1, and R2 bindings.

## Owned files

- next idempotent D1 migration under the Worker package
- typed D1 release/audit helpers
- authenticated publisher endpoint or equivalent Worker command
- R2 transaction/storage helpers
- isolated D1/R2 schema and upload tests
- local migration/read-back documentation

Channel-head reads and promotion belong to S03.

## Data model

### `releases`

One immutable row per release ID:

- `release_id` primary key; globally unique and never reused
- `feature_id`, version, platform, runtime version, minimum host version
- release-envelope/object key and SHA-256
- archive key, SHA-256, archive bytes, expanded bytes, entry count
- app-wide SPKI signing fingerprint for audit only
- status: `uploading`, `ready`, or `rejected`
- created/ready UTC timestamps

A ready row's identity, hashes, compatibility, and object keys are immutable.

### `channel_revisions` and `channel_heads`

Create the tables needed by S03 now so one migration owns referential integrity:

- append-only `(feature_id, channel, revision)` rows referencing ready releases
- activation, force, exact signed envelope bytes/hash, signing fingerprint,
  actor, and timestamp
- one head per `(feature_id, channel)` referencing a revision

S02 does not expose or mutate channels beyond schema/constraint fixtures.

### `audit_events`

Append-only event ID, action, actor, bounded feature/channel/release references,
timestamp, and redacted JSON metadata. Never store credentials, private keys,
authorization headers, archive content, or user initial data.

## Schema requirements

- Reject negative sizes, unsupported platform/status values, broken foreign
  keys, duplicate immutable identities, and duplicate revisions.
- Index releases by feature/platform/time and status; index channel history by
  feature/channel/revision descending.
- Enable foreign keys in every connection/test.
- Bound all user-controlled identifiers at the application boundary and with DB
  checks where practical.
- Reapplying the normal migration workflow is nondestructive.

## Publication transaction

```text
authenticate publisher
  -> validate bounded metadata and safe identifiers
  -> create/resume uploading row
  -> verify RSA-SHA256 envelope with configured app-wide public key
  -> require type=lynx-release and exact requested feature
  -> validate compatibility, archive size/hash, and exact payload contract
  -> stream archive to immutable or non-public temporary R2 key
  -> write exact signed manifest/envelope bytes
  -> read R2 metadata/bytes back and recompute size/hash
  -> atomically mark D1 release ready
  -> append redacted audit event
```

Object keys are server-constructed only:

```text
<feature>/releases/<releaseId>/manifest.json
<feature>/releases/<releaseId>/release.zip
```

Temporary objects, if needed, use a separate non-public prefix. Public routes
must never expose uploading/rejected/temporary objects.

## Authentication and bounds

- Authenticate/authorize before substantial body processing.
- Stream or otherwise hard-bound input; never hold an unbounded ZIP in Worker
  memory.
- Bound metadata/body bytes, request duration, and concurrent work.
- Validate route/payload identifiers before D1 queries or R2 key construction.
- Callers cannot select arbitrary object keys or SQL fragments.
- Return stable errors without stack traces, secrets, bucket configuration, or
  database statements.
- Add rate limiting or document the exact platform control.

## Retry, conflict, and failure behavior

- Same release ID plus identical envelope/archive bytes is idempotent.
- Same release ID plus different bytes/metadata returns explicit conflict and
  never overwrites ready objects.
- R2/D1/signature/hash/timeout failures leave no ready release.
- Read-back mismatch keeps the release non-ready and non-public.
- Cleanup/reconciliation can remove abandoned temporary objects without
  deleting immutable ready objects.
- A request cannot mutate a ready release back into different bytes.

## Acceptance criteria

- [ ] Fresh isolated D1 migration creates all tables, constraints, indexes, and
      foreign keys; normal reapplication is safe.
- [ ] Invalid sizes/status/platform/foreign key/duplicate revision inserts fail.
- [ ] Valid signed release streams to R2, reads back with the signed hash, then
      becomes ready.
- [ ] Wrong key/type/feature/signature/hash/length/runtime or oversized input
      never becomes ready.
- [ ] Identical retry is idempotent; different bytes under the ID conflict.
- [ ] Injected failure at every write/read/commit boundary retains prior state
      and exposes no public partial release.
- [ ] Concurrent same-ID uploads cannot overwrite or create contradictory rows.
- [ ] D1, R2, audit, and logs contain no private signing material or credential.

## Required verification

- Run Worker typecheck and isolated migration/schema tests.
- Run upload integration tests against local D1/R2 bindings.
- Read back manifest and ZIP and show their hashes match signed metadata.
- Exercise unauthorized, malformed, truncated, idempotent, conflict,
  concurrency, and injected storage/database failures.
- Show redacted read-back rows for releases and audit events.

## Out of scope

- Public download/channel endpoints and promote/rollback (S03).
- Local physical-device server (S04).
- Production migration execution, bucket deployment, or credential creation.
- Deleting immutable ready releases.
