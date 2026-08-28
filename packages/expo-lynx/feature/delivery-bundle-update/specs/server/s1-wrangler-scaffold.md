# PR1 — Wrangler scaffold + R2 + D1 bindings

**Spec:** feature/delivery-bundle-update/specs/server/s1-wrangler-scaffold.md

## Goal

Hello world Worker with R2 + D1 bindings. `wrangler dev` runs locally.

## Files

- `wrangler.toml`
- `src/index.ts`

## Contract

Wrangler declares R2 bucket `lynx-artifacts` and D1 binding `DB`. `GET /` returns `hello world`.

## Why

See [Architecture](../../ARCHITECTURE.md).

## Acceptance criteria

- [ ] `wrangler dev` boots without errors
- [ ] `GET http://localhost:8787/` returns 200 with body `hello world`
- [ ] `wrangler r2 bucket list` shows `lynx-artifacts`

## Out of scope

- Auth (S2)
- Migrations (run before S2)
