# Delivery console and Worker spec

The authoritative MVP implementation contract is:

[W01 — Cloudflare Worker upload, deployment, and delivery](../../packages/expo-lynx/feature/delivery-bundle-update/specs/v2/worker/w01-delivery-worker.md)

It replaces the earlier CLI-signed release manifest design. The active model
uses:

- one unsigned `release.json` kept only in the local CLI output;
- one immutable `release.zip` object in R2;
- exactly two D1 tables: `bundles` and `deployments`;
- one Worker private signing key; and
- one plain signed deployment JSON response verified by mobile.

The console remains a single `/` page for listing bundles, selecting or rolling
back the one deployment, choosing force, and enabling or disabling delivery.
