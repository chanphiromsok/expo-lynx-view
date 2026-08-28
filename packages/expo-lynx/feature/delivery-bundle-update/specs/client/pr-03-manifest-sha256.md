# PR3 — Manifest contract + SHA-256 verification

**Spec:** feature/delivery-bundle-update/specs/client/pr-03-manifest-sha256.md

## Goal

Every bundle loaded in Release is verified by SHA-256 before Lynx sees its bytes.

## Files

- `src/manifest.ts (new — types matching 02-bundle-delivery.md)`
- `ios/LynxManifest.swift (new — parse, hash-check)`
- `ios/ExpoLynxView.swift (call manifest check before `loadTemplate`)`

## Contract

Manifest JSON shape identical to `../../ARCHITECTURE.md`. SHA-256 check is per-file; signature check is a separate PR (PR6).

## Why

See [Architecture](../../ARCHITECTURE.md).

## Acceptance criteria

- [ ] A Release build fed a manifest with a wrong SHA-256 emits `stage: 'checksum'` error and never calls `lynxView.loadTemplate`
- [ ] A correct manifest proceeds to `lynxView.loadTemplate`

## Out of scope

- Ed25519 signature check (PR6)
- Channel pointer fetch (PR6)
