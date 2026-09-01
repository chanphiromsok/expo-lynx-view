# `@expo-lynx/bundle-cli`

The bundle CLI builds an isolated Lynx feature, creates one deterministic ZIP,
and uploads it through the delivery Worker. It does not sign releases, read a
release PEM, or receive R2 credentials.

## Release workflow

```sh
export LYNX_DELIVERY_SERVER="http://127.0.0.1:8787"
export LYNX_DELIVERY_CONTROL_TOKEN="<local-control-token>"

# Build, package, request a short-lived upload URL, upload the ZIP directly,
# and ask the Worker to verify and register it.
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
  "runtimeVersion": "expo-57",
  "archiveSha256": "9da2223840940f013b8ffa763b4a1dde4959c8647cee8a9c1b465d16b7dd692f",
  "archiveBytes": 344959
}
```

The command sends this exact metadata only to the authenticated Worker control
API. The Worker returns one short-lived PUT instruction. The CLI sends only raw
`release.zip` bytes and the Worker-provided headers to that URL—never the
control token. It then calls completion, where the Worker validates the R2
object’s exact SHA-256 and byte length before inserting an immutable bundle.

To retry an already-built draft:

```sh
pnpm lynx release upload \
  ./dist/lynx-releases/delivery/delivery-20260901T011848990Z-ac8c0e
```

`--server` and `--token` override the two environment variables. `--json`
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
