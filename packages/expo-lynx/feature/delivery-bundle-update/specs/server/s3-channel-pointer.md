# PR3 — Channel pointer endpoint

**Spec:** feature/delivery-bundle-update/specs/server/s3-channel-pointer.md

## Goal

`GET /lynx/channels/:feature/:channel` reads D1 `channel_pointers`, returns the signed channel pointer.

## Files

- `src/channel.ts`

## Contract

Reads `channel_pointers` JOIN `releases`. Cached at edge for 60s (`Cache-Control: public, max-age=60, s-maxage=60`).

## Why

See [Architecture](../../ARCHITECTURE.md).

## Acceptance criteria

- [ ] `GET /lynx/channels/delivery/stable` returns the channel pointer JSON
- [ ] Setting `Cache-Control` header is verified in the response
- [ ] Unknown feature/channel → 404

## Out of scope

- Per-user targeting (out of scope per 08)
