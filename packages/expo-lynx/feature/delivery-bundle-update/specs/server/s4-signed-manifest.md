# PR4 — Signed release manifest

**Spec:** feature/delivery-bundle-update/specs/server/s4-signed-manifest.md

## Goal

`GET /lynx/manifests/release/:id` returns the immutable signed manifest from R2. Client trust keys ship inside the signed app.

## Files

- `src/manifest.ts`

## Contract

Manifest served with `Cache-Control: public, max-age=31536000, immutable`. The private Ed25519 key lives only in a Worker secret.

## Why

See [Architecture](../../ARCHITECTURE.md).

## Acceptance criteria

- [ ] `GET /lynx/manifests/release/<id>` returns the signed JSON
- [ ] Missing manifest → 404
- [ ] D1 and R2 contain no private signing key

## Out of scope

- Key rotation workflow (separate PR)
