# `@expo-lynx/bundle-cli`

The CLI builds an isolated Lynx feature, creates one deterministic ZIP, signs
its R2 request locally, and asks the delivery Worker to verify it. It does not
sign mobile deployments or read the Worker's RSA private key.

## Release workflow

```sh
export LYNX_DELIVERY_SERVER="http://127.0.0.1:8787"
export LYNX_DELIVERY_API_KEY="<local-delivery-api-key>"

# Build, package, upload the ZIP, and ask the Worker to verify and register it.
pnpm lynx release delivery

# Build only. This performs no network request.
pnpm lynx release delivery --draft
```

The draft output contains exactly two files:

```text
dist/lynx-releases/<feature>/<releaseId>/
  release.json
  release.zip
```

`release.json` is local, unsigned upload metadata. It is never served to
mobile and is never stored in R2:

```json
{
  "schemaVersion": 1,
  "feature": "delivery",
  "releaseId": "delivery-20260901T011848990Z-ac8c0e",
  "version": "2026.09.01",
  "runtimeVersion": "<Expo native fingerprint>",
  "archiveSha256": "9da2223840940f013b8ffa763b4a1dde4959c8647cee8a9c1b465d16b7dd692f",
  "archiveBytes": 344959
}
```

The command sends this exact metadata to the authenticated Worker upload API,
uploads only `release.zip` directly to R2, then calls completion. The Worker
validates the R2 object's exact SHA-256 and byte length before inserting an
immutable bundle. Production upload requires `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID` (or `CLOUDFLARE_ACCOUNT_ID`), and
`R2_BUCKET_NAME` (or `LYNX_DELIVERY_R2_BUCKET`). Local Worker mode needs none
of these because it uses its local R2 binding.

`pnpm lynx bundle <feature>` calculates the fingerprint and saves it in the
embedded registry. `pnpm lynx release <feature>` reads that saved value so a
remote ZIP can only target the native baseline it was built with. Run `bundle`
again before creating a new native binary when native inputs change.

To retry an already-built draft:

```sh
pnpm lynx release upload \
  ./dist/lynx-releases/delivery/delivery-20260901T011848990Z-ac8c0e
```

`--server` and `--api-key` override the two environment variables. `--json`
prints the registered bundle record. The command never selects a bundle,
enables delivery, or requests force reload; make those choices in the console.

## Configuration

`lynx-bundle.config.ts` declares feature roots and output paths. It has no
signing-key configuration.

```ts
import { defineConfig } from '@expo-lynx/bundle-cli';

export default defineConfig({
  featuresDir: './features',
  features: { delivery: {} },
  embeddedOutputDir: './generated/expo-lynx/embedded',
  releaseOutputDir: './dist/lynx-releases',
});
```

The accepted runtime output is exactly `main.lynx.bundle` plus `static/**`
sidecars. The packer rejects unsafe paths, links, unexpected files, and ZIPs
over the mobile archive limits before any upload is attempted. Current release
packaging targets iOS; Android is deferred.

See the [delivery console guide](../../apps/console/README.md) for Cloudflare
setup, credentials, local D1/R2 testing, and console promotion.
