# S03 — Public delivery API and channel promote/force/rollback operations

**Spec:** `feature/delivery-bundle-update/specs/v2/server/s03-channel-api-operations.md`

## Goal

Implement the complete channel state boundary: cache-correct public
channel/manifest/artifact reads plus authenticated promote, force-timing, and
rollback operations that append and sign monotonic revisions atomically.

## Why these tasks are merged

A public channel response is the exact output of promotion. Keeping reads and
writes in separate specs made it possible to store one byte sequence and return
another or to implement rollback without matching replay rules. This spec tests
the channel state machine end to end.

## Depends on

- [M01 — Shared release protocol](../mobile/m01-shared-release-protocol.md).
- [S01 — Build, package, and signing contract](s01-build-package-sign.md).
- [S02 — Release storage/publication](s02-release-storage-upload.md).

## Owned files

- public channel, manifest, and ZIP routes
- authenticated promote/rollback operator routes or commands
- channel revision/head transaction helpers
- cache/ETag, authorization, concurrency, and rollback tests
- audit-event integration

## Public routes

Provide equivalents of:

```text
GET /v1/channels/:feature/:channel
GET /v1/releases/:feature/:releaseId/manifest
GET /v1/releases/:feature/:releaseId/release.zip
```

- Channel response is the exact stored signed `lynx-channel` envelope.
- Manifest response is the exact stored signed `lynx-release` envelope.
- Artifact response is the exact immutable ZIP linked by signed metadata.
- Release routes are feature-scoped because ready release storage is scoped by
  `<feature>/releases/<releaseId>/…`. The client follows the verified signed
  relative `manifestUrl`; it does not synthesize either release route.
- Never return or trust a response-supplied public key.
- Validate identifiers before queries/object-key construction.
- Only ready releases and the committed channel head are visible.
- Uploading/rejected/temporary/unknown objects return safe not-found behavior.

## Cache and HTTP contract

- Channel uses a strong ETag from exact envelope bytes/revision, short
  revalidation policy, and `If-None-Match`/`304`.
- Manifest and ZIP use release-scoped immutable URLs, strong ETags, and
  long-lived immutable caching.
- Return correct content type/length/disposition.
- Do not dynamically gzip ZIP.
- Stream downloads. Support tested ranges if reliable; otherwise explicitly use
  full clean-retry downloads and never append to partial bytes.
- Missing/corrupt R2 behind a ready row fails closed with telemetry, not `200`.

## Operator operations

A promote/rollback request contains feature, channel, ready release ID,
activation, force, idempotency key, and optional expected head.

### Promotion

- Target must be ready, compatible, and owned by the requested feature.
- Default activation is `next-open`.
- `on-launch` requests the M04 candidate-view path.
- `force` changes consideration timing only; it cannot bypass signature,
  compatibility, installation, health, failed-ID blocking, or rollback.
- Authorize the actor for the exact feature/channel.

### Rollback

Rollback appends revision `N + 1` pointing to an older ready compatible release.
It never edits history, lowers the revision, mutates the release, or deletes R2
bytes. Clients accept deliberate rollback because the channel revision is newer.

## Atomic channel transaction

```text
authenticate + authorize actor
  -> validate ready compatible target and expected head
  -> reserve revision N+1
  -> construct exact type=lynx-channel payload once
  -> sign exact bytes with S01 app-wide key
  -> insert immutable revision with exact envelope bytes/hash
  -> advance head to that revision
  -> append redacted audit event
  -> commit atomically
```

Failed signing/database work leaves the old head unchanged. Two concurrent
operations either receive distinct ordered revisions or one gets a clear
conflict/retry; they never write the same revision or expose a torn head.

An idempotency key replay with identical request returns the original result;
reuse with different content conflicts.

## Response and security behavior

- Public errors are stable, small, and omit DB schema, bucket keys, stack traces,
  credentials, internal actor identity, and signing secrets.
- Operator authentication is deployment-appropriate and tested before mutation.
- Signed payload feature/type is rechecked before storing/serving.
- Exact stored envelope bytes equal exact public response bytes.
- Audit includes actor/action/target/revision without credentials or private
  material.

## Acceptance criteria

- [ ] Valid promotion creates revision `N + 1`, changes channel ETag, and public
      fetch verifies against S01/M01 fixtures.
- [ ] `If-None-Match` returns `304`; a later promotion returns a new ETag/body.
- [ ] Immutable manifest/ZIP bytes and headers remain stable across requests.
- [ ] `next-open`, `on-launch`, and force values round-trip exactly.
- [ ] Rollback creates a higher revision pointing to older immutable bytes and
      preserves history/audit.
- [ ] Invalid/unready/wrong-feature/incompatible/unauthorized target leaves head
      unchanged.
- [ ] Concurrent operations preserve monotonic revisions or explicit conflict.
- [ ] Idempotent replay creates no duplicate revision.
- [ ] Public routes cannot retrieve temporary/unready/unrelated objects.
- [ ] Missing/corrupt backing object yields an error/telemetry, never partial
      success.

## Required verification

- Run Worker typecheck and route/transaction integration tests.
- Exercise public channel → manifest → ZIP verification.
- Assert ETag, `304`, cache headers, content type/length, and range/full-retry
  policy.
- Exercise promote, force, rollback, authorization, expected-head conflict,
  idempotent replay, and concurrent races.
- Read back exact stored/returned envelope bytes and redacted audit history.

## Out of scope

- Web console UI, production deployment, DNS, and Cloudflare Access setup.
- Deleting release/channel history.
- Cohorts, percentage rollout, or remotely destroying a mounted view.
- Mobile implementation.
