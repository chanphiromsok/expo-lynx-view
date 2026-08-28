# PR2 — Release upload endpoint

**Spec:** feature/delivery-bundle-update/specs/server/s2-release-upload.md

## Goal

`POST /lynx/releases` accepts a multipart manifest + bundle + sidecars. Verifies SHA-256 of every file, signs the manifest, uploads each file to R2 at `delivery/<release-sha256>/…`, inserts a row into `releases`.

## Files

- `src/release.ts`
- `migrations/001_releases.sql`

## Contract

Auth: `Authorization: Bearer ${env.RELEASE_PIPELINE_SECRET}`. Request body is multipart with one manifest part and N file parts.

## Why

See [Architecture](../../ARCHITECTURE.md).

## Acceptance criteria

- [ ] CI POST to `/lynx/releases` with a valid manifest returns 200 + `{ release_id, manifest_url }`
- [ ] Wrong SHA-256 in manifest body → 400, no R2 upload, no D1 row
- [ ] Missing bearer → 401

## Out of scope

- Channel pointer write (S3 — separate endpoint)
- Key rotation
