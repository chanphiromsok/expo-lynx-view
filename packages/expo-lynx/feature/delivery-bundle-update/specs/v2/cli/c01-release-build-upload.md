# C01 — CLI build, package, and upload

**Spec:** `feature/delivery-bundle-update/specs/v2/cli/c01-release-build-upload.md`

## Goal

Provide one oclif-backed command that builds a configured Lynx feature,
packages one deterministic `release.zip`, computes its SHA-256, uploads it
directly to R2 with the CLI's local S3 credential, and completes registration.

The CLI does not generate, read, or require a PEM signing key. It does not
create a signed release manifest or upload bundle bytes through the Worker.

## Depends on

- The configured Rspeedy production build for each feature.
- [W01 — Worker storage and delivery](../worker/w01-delivery-worker.md) for the
  upload API.

## Owned files

- `packages/lynx-bundle-cli/`
- `scripts/lynx.mjs`
- root/package command documentation and focused CLI tests

## Public command

The normal workflow is one command:

```bash
export LYNX_DELIVERY_SERVER="http://127.0.0.1:5173"
export LYNX_DELIVERY_API_KEY="lynx_live_<your-api-key>"

pnpm lynx release delivery
```

Supported configuration:

- `--server` overrides `LYNX_DELIVERY_SERVER`.
- `--api-key` overrides `LYNX_DELIVERY_API_KEY` without printing it.
- `--json` emits one machine-readable result.
- `--draft` builds the local two-file release directory without network calls.

There is no `--private-key`, channel, activation, or browser-upload option.
Production direct upload uses `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_ACCOUNT_ID` (or `CLOUDFLARE_ACCOUNT_ID`), and `R2_BUCKET_NAME` (or
`LYNX_DELIVERY_R2_BUCKET`), normally from ignored `.env.lynx`.

## Local release directory

```text
dist/lynx-releases/<feature>/<releaseId>/
  release.json
  release.zip
```

`release.json` is unsigned resumable upload metadata. It is not a mobile
manifest and is never uploaded to public R2 storage:

```json
{
  "schemaVersion": 1,
  "appId": "shop",
  "feature": "delivery",
  "releaseId": "delivery-20260901T011848990Z-ac8c0e",
  "version": "2026.09.01",
  "runtimeVersion": "expo-57",
  "archiveSha256": "9da2223840940f013b8ffa763b4a1dde4959c8647cee8a9c1b465d16b7dd692f",
  "archiveBytes": 344959
}
```

The CLI writes no `release-payload.json`, `release-envelope.json`,
`packaging-report.json`, signature, public-key fingerprint, per-file hash list,
or embedded API key.

## Build and package contract

- Resolve the feature and config relative to the config file, not the caller's
  current directory.
- Run the existing isolated Rspeedy production build.
- Package only runtime output: exactly one `main.lynx.bundle` and its required
  `static/**` sidecars.
- Exclude source maps, caches, dotfiles, reports, configuration, and source.
- Normalize ZIP paths, ordering, timestamps, ownership, and permissions so the
  same inputs produce identical ZIP bytes.
- Reject traversal, absolute/backslash paths, duplicates, symlinks, hard links,
  devices, encryption, unexpected files, and the M01 size/count limits before
  upload.
- Compute SHA-256 and byte length from the final ZIP bytes.
- Build into a temporary sibling directory and rename only after both output
  files are complete.

## Upload protocol

The CLI sends the exact parsed `release.json` fields to:

```http
POST /api/uploads
authorization: Bearer <api-key>
content-type: application/json
```

The Worker returns `complete: true` for an identical registered release or a
pending `bundleId`. The CLI signs a PUT to the canonical R2 object key with its
local S3 credential:

```json
{
  "bundleId": "delivery-20260901T011848990Z-ac8c0e",
  "complete": false
}
```

The CLI sends only raw ZIP bytes with `application/zip` and the archive SHA-256
to R2; it never forwards its delivery API key to R2.
After a successful PUT it sends the same release metadata to:

```http
POST /api/uploads/:bundleId/complete
authorization: Bearer <api-key>
content-type: application/json
```

The CLI treats the registration and completion APIs as idempotent. Re-running
upload for the same ID and exact metadata succeeds; the same ID with different
metadata fails as conflict. HTTP redirects on the R2 PUT are rejected.

For local Miniflare testing, `LOCAL_UPLOADS=true` uses the local R2 binding;
the CLI needs no production R2 S3 credential.

## Output and errors

Success prints the feature, release ID, ZIP path, SHA-256, byte length, and
registration result. It never prints tokens, R2 credentials, private
environment values, or ZIP content.

Errors identify the failing stage and actionable endpoint:

```text
Build failed: <safe cause>
Package failed: <safe cause>
Registration failed at http://127.0.0.1:5173/api/uploads: <status and safe API message>
R2 upload failed with HTTP 403 — R2 AccessDenied. Check the local R2 S3 credential has Object Read & Write for this bucket.
Completion failed: <status and safe API message>
```

Connection errors must distinguish an unreachable Worker from authentication,
missing Worker signing configuration, missing R2 configuration, and checksum
failure.

## Acceptance criteria

- [ ] One command performs build, package, register, direct upload, and complete.
- [ ] `--draft` creates exactly `release.json` and `release.zip` and performs no
      network request.
- [ ] Repeated equal inputs create byte-identical ZIPs and metadata hashes.
- [ ] The CLI starts with no private/public release-signing key configuration.
- [ ] The API key appears only on Worker upload API requests and never
      on the R2/local PUT request or in output.
- [ ] The CLI signs an R2 PUT with only its local S3 credential; the delivery
      API key is never sent to R2.
- [ ] Identical retry succeeds and conflicting reuse fails clearly.
- [ ] Missing artifacts, invalid metadata, unreachable Worker, 401, 503, R2
      failure, and completion failure produce safe actionable messages.
- [ ] Tests execute a full mocked register -> PUT -> complete flow and a real
      local Worker flow without a native build.

## Required verification

```bash
pnpm --filter @expo-lynx/bundle-cli lint
pnpm --filter @expo-lynx/bundle-cli test
pnpm lynx release delivery --draft
git diff --check
```

The Rspeedy JavaScript build is allowed. This verification must not invoke
Xcode, an iOS simulator, CocoaPods, Gradle, or any native build.

## Out of scope

- Signing keys, manifest signing, deployment selection, browser upload,
  promotion, rollback, native installation, multipart ZIP upload, delta
  packages, and production Cloudflare deployment.
