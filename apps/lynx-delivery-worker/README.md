# Lynx delivery Worker

Cloudflare Worker entry point for signed Lynx bundle delivery. This initial
scaffold exposes `GET /` and `GET /health`; R2 and D1 bindings are declared but
are not used until the release and channel endpoints are implemented.

## Local development

```sh
pnpm dev
```

Then request `http://localhost:8787/health`.

## Cloudflare provisioning

Before deployment, create the bound resources and replace the placeholder D1
database ID in `wrangler.toml`:

```sh
pnpm exec wrangler r2 bucket create lynx-artifacts
pnpm exec wrangler d1 create lynx-delivery
```
