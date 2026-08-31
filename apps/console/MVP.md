# Console production MVP

## Outcome

Ship one Cloudflare-hosted operator console that lets a small trusted release
team inspect CLI-uploaded Lynx releases, promote one to the fixed `active`
deployment, and roll it back. A mobile client must receive only immutable
signed release data through the existing public delivery routes.

The MVP is production-ready when a release operator can complete this path in
the staging environment and then production without a manual D1 edit or R2
object upload:

```text
build and sign in trusted CLI/CI
  → CLI registers the signed envelope with the Worker
  → Worker returns a short-lived presigned R2 PUT
  → CLI uploads release.zip directly to R2 and finalizes it
  → operator promotes it to active
  → device downloads, verifies, stages, and activates it
  → operator can promote an earlier ready release to roll back
```

## Product boundary

### In scope

1. **One hosted console and one Worker deployment**
   - The console SPA and Worker deploy from `apps/console`.
   - The Worker exposes the existing public `/v1/*` delivery routes and an
     authenticated `/api/*` operator API from the same deployment.
   - Staging and production use separate Worker names, D1 databases, R2
     buckets, and Cloudflare Access applications.

2. **Trusted operator access**
   - Cloudflare Access protects the console and every `/api/*` route.
   - The Worker validates the Access assertion and records the authenticated
     actor on every mutation.
   - The browser never receives a Cloudflare API token, R2 access key, or
     release private key.

3. **Release catalogue**
   - List releases for a feature with ID, version, platform, runtime version,
     archive size, SHA-256, signing key fingerprint, state, and timestamps.
   - View the stored signed release envelope and read-only metadata.
   - Show the current release for the fixed `active` deployment and revision.

4. **Signed release upload**
   - Accept an already-signed `release-envelope.json` from the trusted CLI.
   - Return a short-lived presigned R2 `PUT` URL so the CLI uploads
     `release.zip` directly without proxying bytes through the Worker.
   - Validate release identity, signature, canonical feature/release ID,
     archive SHA-256, archive byte length, platform, runtime compatibility,
     and configured size/entry-count limits before a release becomes ready.
   - Store release files in server-constructed immutable R2 keys only.
   - Reject any attempt to reuse a release ID with different bytes.
   - Finalize only after the Worker verifies the uploaded R2 object.
   - Support an idempotency key so a CLI retry cannot create a conflicting
     release or duplicate audit entry.

5. **Promotion and rollback**
   - Promote only a ready release to the feature's `active` deployment.
   - Require an explicit activation mode (`next-open` or `on-launch`) and an
     explicit force choice.
   - Promotion creates an append-only D1 channel revision and atomically moves
     the channel head.
   - Rollback is a promotion to an earlier ready release; it never mutates or
     deletes release bytes.
   - Enable or disable remote delivery independently from promotion. Disabling
     keeps the channel head and revisions intact, and promotion does not
     silently re-enable it.

6. **Audit and operational visibility**
   - Record upload, promote, rollback, enable, disable, and rejection events
     with actor, feature, channel, release ID, revision, timestamp, and
     redacted metadata.
   - Provide a paginated audit view filtered by feature and channel.
   - Return typed, safe errors to the UI; never expose object keys, SQL,
     credentials, stack traces, or signing material.

7. **Public device delivery contract**
   - Preserve the current public contracts:

     ```text
     GET /v1/channels/:feature/active
     GET /v1/releases/:feature/:releaseId/manifest
     GET /v1/releases/:feature/:releaseId/release.zip
     ```

   - Keep strong ETags, channel no-cache behavior, immutable artifact caching,
     and device-side signature/archive verification.
   - When a channel is disabled, its channel route returns `204 No Content`
     with `Cache-Control: no-store`; its immutable artifacts remain available.

## Explicitly not in the MVP

- Multi-tenant organizations, self-service user management, or granular RBAC.
- Building, signing, or generating a release in the browser.
- Browser access to a private signing key or Cloudflare management credential.
- Editing, replacing, deleting, or re-signing a stored release.
- Production release analytics, percentage rollouts, automatic rollback, or
  approval workflows.
- Android delivery support beyond preserving schema compatibility.
- A general-purpose artifact browser or R2 file manager.
- Public access to console metadata or any console mutation route.

## API surface

The browser calls same-origin authenticated read/promotion endpoints. The CLI
uses scoped service authentication for release registration and completion.
The MVP must cover these operations:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/channels/:feature/:channel` | Console overview and recent releases. |
| `PATCH` | `/api/channels/:feature/:channel` | Enable or disable remote delivery. |
| `GET` | `/api/releases?feature=:feature` | Paginated release catalogue. |
| `GET` | `/api/releases/:releaseId` | Release detail and envelope metadata. |
| `POST` | `/api/releases` | Register a signed envelope and return a presigned R2 PUT. |
| `POST` | `/api/releases/:releaseId/complete` | Verify the uploaded R2 object and finalize the release. |
| `POST` | `/api/promotions` | Promote or roll back a ready release. |
| `GET` | `/api/audit` | Paginated audit log. |

All write requests require a validated operator identity, a JSON-safe request
body, an `Idempotency-Key`, and an authoritative response that the TanStack
Query cache can use to refresh only the affected feature/channel keys.

## Delivery milestones and launch gates

### M1 — Foundation and environment isolation

- Create staging and production D1/R2/Worker resources.
- Add the channel configuration table and backfill existing channel heads as
  enabled so the migration preserves current delivery behavior.
- Apply the tracked migration independently to each environment.
- Configure Cloudflare Access for the console and console API paths, while
  leaving only `/v1/*` public.
- Configure secrets and public verification-key material without committing
  them to the repository.

**Exit gate:** an unauthenticated request cannot read console data or mutate
state; a mobile client can still request the public `/v1/*` data plane.

### M2 — Read-only console

- Replace preview-only data in `src/features/delivery/delivery-api.ts` with
  D1-backed same-origin console reads.
- Show empty states, loading states, user-safe API errors, release detail, and
  channel head/revision.
- Add local D1 seed data and integration tests that exercise the Worker against
  local D1 and R2 state.
- Show and persist the channel's enabled/disabled state.

**Exit gate:** the console accurately reflects D1/R2 state and does not show
invented preview releases in a hosted environment.

### M3 — Immutable direct upload

- Implement signed-envelope validation, presigned R2 PUT creation, and
  completion verification without proxying archive bytes through the Worker.
- Enforce canonical R2 keys, immutable release IDs, byte/hash checks, limits,
  idempotency, and audit events.
- Add failure-path tests: invalid signature, invalid identity, wrong archive
  hash, repeated upload, conflicting release ID, oversized archive, and R2/D1
  failure recovery.

**Exit gate:** a valid package is stored once and becomes `ready`; every failed
package leaves no public channel change and no ambiguous release state.

### M4 — Promotion, rollback, and device verification

- Implement append-only channel promotions and rollback UI.
- Require confirmation that shows feature, channel, target release, activation,
  and previous release.
- Write audit records and return the new authoritative channel revision.
- Exercise: upload → promote → public channel fetch → device verification →
  next-open activation → rollback.
- Verify disabled channels return no remote bundle and re-enabling restores the
  unchanged channel head.

**Exit gate:** a staging operator can complete the full flow twice, including a
rollback, with expected D1 revisions, R2 objects, public cache headers, and
device behavior.

### M5 — Production launch readiness

- Run production migration and a controlled first release.
- Verify Cloudflare Access policy, audit visibility, D1/R2 bindings, ETags,
  public cache behavior, error responses, and monitoring/alert routing.
- Document the operator runbook, incident rollback procedure, access revocation
  procedure, and release verification checklist.

**Exit gate:** two authorized operators can independently follow the runbook;
one successfully publishes and the other successfully rolls it back without
direct Cloudflare dashboard database edits.

## Definition of done

The MVP is complete only when all of these are true:

- Every console write is authenticated, authorized, auditable, idempotent, and
  tested against local D1/R2.
- A release is immutable once ready, and a channel change is append-only.
- The public Worker serves only ready releases and never exposes console APIs,
  secrets, or internal storage paths.
- A staging iOS device completes a signed download, verification, staging,
  activation, and rollback from the hosted console.
- Production and staging are isolated, documented, monitored, and recoverable
  through the console workflow.
