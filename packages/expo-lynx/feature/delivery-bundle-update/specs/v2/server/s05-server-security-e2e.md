# S05 — Server security and end-to-end release gate

**Spec:** `feature/delivery-bundle-update/specs/v2/server/s05-server-security-e2e.md`

## Goal

Prove build, signing, upload, read-back, promotion, public download, rollback,
authorization, caching, and failure recovery operate as one production-safe
server protocol.

## Depends on

- [S01](s01-build-package-sign.md) through
  [S04](s04-local-static-parity.md).
- M01 fixtures and current iOS installation/activation behavior from M03/M04.

## Scope

- isolated Worker/D1/R2 integration environment
- scripted package → sign → upload → read-back → promote → client verify →
  second promote → rollback scenario
- malicious, authorization, concurrency, caching, storage-failure, and secret
  tests
- reproducible documentation and measured local regression baselines

## Required matrix

### Happy path

- Package two mini-apps without namespace collision.
- Sign/upload and verify R2 read-back before D1 readiness.
- Promote with `next-open`; fetch/verify channel, manifest, and ZIP.
- Publish/promote a second release and verify revision/ETag advance.
- Roll back with a newer revision pointing to the first release.

### Authenticity/integrity

- Mutated payload, signature, archive, and extracted file.
- Wrong key, document type, feature, development key in production.
- Hash/length/entry-count mismatch and reused release ID with new bytes.
- Replayed lower revision and reused operator idempotency key.

### ZIP/resource abuse

- Traversal/absolute/backslash paths, duplicates/collisions, symlink/hard-link/
  device entries, limits, ratio bomb, corrupt/truncated ZIP, CRC, unsupported
  compression.

### Service/concurrency

- Missing/invalid publisher/operator authorization.
- Concurrent same-ID uploads and concurrent channel operations.
- Injected D1/R2 failure at each boundary.
- Missing/corrupt ready object, `304`, immutable caching, slow/interrupted retry.

## Security and performance evidence

- Scan tracked/generated content and logs for private keys/tokens.
- Prove identifiers cannot select SQL/R2 keys and public routes cannot expose
  unready/unrelated content.
- Record packaging time/memory, upload validation time/memory, local route
  latency, and archive throughput with test machine/archive size.
- Treat measurements as regression baselines, not production SLAs.

## Acceptance criteria

- [ ] Clean-state happy path and rollback pass end to end.
- [ ] Every malicious/injected failure fails closed without bad readiness or
      lost prior channel head.
- [ ] Concurrency preserves immutable releases and monotonic revisions.
- [ ] Secret scans/redaction assertions pass.
- [ ] A fresh developer can reproduce locally without production credentials.

## Required verification

- Run Worker/package typecheck, lint, unit, integration, and scripted E2E tests.
- Attach matrix results, D1/R2 hash read-back, final channel history, performance
  context, and redacted logs.
- Run post-PR review checklist against the current iOS M03/M04 behavior. The
  both-platform M08 gate remains in the Android roadmap.

## Out of scope

- Production deployment/DNS/alerting/secret provisioning.
- Cohorts or claims unsupported by production-like load tests.
- Replacing Expo Updates for the React Native host.
