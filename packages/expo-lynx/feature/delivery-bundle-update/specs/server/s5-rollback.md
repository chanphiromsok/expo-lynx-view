# PR5 — Rollback workflow

**Spec:** feature/delivery-bundle-update/specs/server/s5-rollback.md

## Goal

`POST /lynx/channels/:feature/:channel/rollback` accepts `{ releaseId }` and re-points the channel. One D1 write, atomic.

## Files

- `src/rollback.ts`

## Contract

Body: `{ releaseId: string }`. Inserts into `channel_pointers` with `ON CONFLICT DO UPDATE`. Returns the new pointer.

## Why

See [Architecture](../../ARCHITECTURE.md).

## Acceptance criteria

- [ ] POST with a valid prior `releaseId` swaps the channel pointer
- [ ] POST with an unknown `releaseId` returns 404
- [ ] Subsequent `GET /channels/.../...` reflects the rolled-back release within 60s (cache TTL)

## Out of scope

- Audit trail UI (out of scope — D1 is the source of truth)
