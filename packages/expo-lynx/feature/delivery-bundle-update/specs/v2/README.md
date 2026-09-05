# Lynx delivery MVP implementation specs

Status: draft for review. These documents define the next implementation; they
do not authorize a production deployment or secret rotation.

Only these three specs are normative for the MVP:

| Area | Spec | Result |
|---|---|---|
| CLI | [C01 — Build and upload](./cli/c01-release-build-upload.md) | Builds one ZIP and uploads it directly to R2 without a signing key |
| Worker | [W01 — Store, authenticate, and deliver](./worker/w01-delivery-worker.md) | Stores minimal D1 state, authenticates Console/CLI control requests, and signs the current deployment response |
| Mobile | [M01 — Verify and activate](./mobile/m01-shared-release-protocol.md) | Verifies the signed response and ZIP SHA-256 before installing |

Before a public mobile release, complete these runtime-safety tasks in order:

| Task | Spec | Result |
|---|---|---|
| 1 | [C02 — Generate the native runtime fingerprint](./cli/c02-native-runtime-fingerprint.md) | Replaces the static `expo-57` label with one Expo project fingerprint |
| 2 | [M10 — UserDefaults to MMKV](./mobile/m10-userdefaults-to-mmkv.md) | Migrates the bounded native launch snapshot without changing delivery behavior |
| 3 | [M09 — Runtime-safe IFR launch](./mobile/m09-runtime-bound-cache.md) | Selects a compatible local bundle and gives it an uninterrupted Lynx first-frame path |
| 4 | [W02 — Scope deployments by runtime](./worker/w02-runtime-scoped-deployments.md) | Lets old and new native builds receive compatible releases from one Worker |

These tasks refine the existing `runtimeVersion` field. They do not add a
second fingerprint field, a channel, another Worker, or another signing flow.

The older `mobile/m02-*` through `mobile/m08-*` and `server/s01-*` through
`server/s05-*` documents describe the superseded two-document design. They are
historical context only and must not be used as implementation requirements.

## Frozen MVP flow

```text
CLI
  build feature
  -> create release.zip
  -> compute ZIP SHA-256
  -> request a short-lived upload URL with its API key
  -> PUT release.zip directly to R2
  -> complete registration

Console
  username + password
  -> HTTP-only session cookie
  -> list registered bundles
  -> select one bundle
  -> enable/disable delivery
  -> request force reload when explicitly chosen

Worker
  validate control requests
  -> verify the uploaded R2 object
  -> store bundle metadata in D1
  -> atomically update the one deployment row per app and feature
  -> sign the exact public deployment response

Mobile
  fetch public deployment response
  -> verify its signature with the public key embedded in the app
  -> validate feature, runtime, revision, and enabled state
  -> download release.zip
  -> verify ZIP bytes and SHA-256
  -> install safely and apply according to force
```

## Decisions

- There is one deployment per `(appId, feature)`. There are no channels, environments,
  rollout cohorts, or stable/beta/active names.
- The CLI has no private signing key. Each enabled user has one API key that
  authorizes only upload API calls; it is never sent to R2 or mobile.
- The Console signs in with username and password. The Worker exchanges a
  successful login for an HTTP-only same-site session cookie.
- The Worker has the only delivery private key. Mobile embeds its corresponding
  public key.
- The Worker signs the exact plain JSON response body. There is no base64
  `payload` wrapper, release envelope, or separately signed release manifest.
- R2 stores one immutable object per registered bundle: `release.zip`.
- The signed response contains one ZIP SHA-256. There are no per-file hashes in
  the wire protocol. Mobile enforces ZIP/path/size limits while installing.
- D1 contains `bundles`, `deployments`, and `users`. `users` holds one
  username, password hash, API-key hash, enabled flag, and creation timestamp
  per Console/CLI user. It has no roles, email, profile, session, audit,
  signing-key-fingerprint, patch, or file table.
- `enabled: false` stops new distribution. It does not delete, deactivate, or
  roll back a verified release already present on a device.
- `force: false` stages a new verified release for the next feature open.
  `force: true` reloads a mounted matching view only after download,
  verification, and installation succeed.
- Production public delivery uses HTTPS. Public reads do not require a user
  credential because authenticity comes from the signed response and ZIP hash.
- The current implementation target is iOS. Android must implement the same
  wire contract later and is not part of this MVP gate.

## Shared wire contract

The Worker returns `GET /v1/:appId/:feature` with:

```http
content-type: application/json; charset=utf-8
cache-control: no-store
lynx-signature: <unpadded-base64url-signature>
```

The signature is RSASSA-PKCS1-v1_5 with SHA-256 over the exact UTF-8 response
body bytes. Protocol version 1 fixes this algorithm; it is not selected by an
untrusted response field.

Enabled body:

```json
{
  "schemaVersion": 1,
  "type": "lynx-deployment",
  "feature": "delivery",
  "revision": 7,
  "enabled": true,
  "force": false,
  "releaseId": "delivery-20260901T011848990Z-ac8c0e",
  "version": "2026.09.01",
  "runtimeVersion": "expo-57",
  "archiveUrl": "/v1/bundles/delivery/delivery-20260901T011848990Z-ac8c0e/release.zip",
  "archiveSha256": "9da2223840940f013b8ffa763b4a1dde4959c8647cee8a9c1b465d16b7dd692f",
  "archiveBytes": 344959,
  "issuedAt": "2026-09-01T01:20:00.000Z"
}
```

Disabled body:

```json
{
  "schemaVersion": 1,
  "type": "lynx-deployment",
  "feature": "delivery",
  "revision": 8,
  "enabled": false,
  "issuedAt": "2026-09-01T01:30:00.000Z"
}
```

Unknown fields fail closed. The disabled form must not contain `force` or any
release/archive field. The enabled form requires every field shown above.

## Implementation order

1. C01 replaces the current pack/sign/upload output with the two-file unsigned
   local release directory.
2. W01 replaces release verification plus stored deployment envelopes with
   direct ZIP registration and Worker response signing.
3. M01 replaces release-envelope fetching with verification of the signed
   deployment response and direct ZIP installation.

Each implementation must preserve unrelated working-tree changes. Automated
work must not start Xcode, an iOS simulator, CocoaPods, or any native iOS build
unless the user explicitly asks for it.

## Required shared verification

```bash
pnpm --filter @expo-lynx/bundle-cli lint
pnpm --filter @expo-lynx/bundle-cli test
pnpm --filter @expo-lynx/delivery-console typecheck
pnpm --filter @expo-lynx/delivery-console test
pnpm --filter expo-lynx exec jest --runInBand --no-watchman
git diff --check
```

Tests must include one fixture whose exact Worker response bytes verify in both
TypeScript and Swift. Private keys, API keys, R2 credentials, and
production data must never be committed or printed.
