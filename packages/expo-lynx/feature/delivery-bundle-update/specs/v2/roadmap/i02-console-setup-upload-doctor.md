# I02 — One-command Console setup, upload contract, and doctor

**Status:** proposed specification for review; implementation has not started.

## Goals

1. Provision the shared Cloudflare Console from any operator workspace without
   cloning this monorepo.
2. Give independent mini-app repositories one stable, runtime-safe upload
   contract.
3. Detect common Console, host-app, and mini-app configuration failures before
   build or upload.

Extend the existing `expo-lynx-bundle-cli` Oclif CLI and current Console
template. Do not create another CLI, hosted setup service, or Cloudflare API
wrapper.

## Depends on

- [I01 — Host-owned runtime and independent releases](i01-independent-miniapp-workspaces.md).
- [D01 — Cross-team integration documentation](d01-cross-team-integration-docs.md)
  for the public handoff after implementation.

## Command surface

```text
lynx console setup                 provision or safely resume Cloudflare setup
lynx console deploy                deploy a newer bundled Console/Worker

lynx host prepare                 local host preparation; no network
lynx host register                register the exact prepared runtime
lynx host prepare --register      prepare and register in one CI command

lynx release                      build, reserve, upload, and complete mini app
lynx release --draft              build two local release files; no network
lynx release upload <directory>   register or resume an existing draft

lynx doctor                       local read-only configuration checks
lynx doctor --remote              local checks plus read-only remote checks
lynx doctor --json                stable machine-readable result
```

All commands discover and load the nearest `.env.lynx` automatically without
overwriting values already present in the process environment. Users should not
need `set -a; source .env.lynx; set +a` for normal CLI usage.

## Console setup contract

### Invocation

An operator can start in an empty infrastructure repository:

```bash
pnpm dlx --package expo-lynx-bundle-cli lynx console setup
```

The published package includes the built Console assets, Worker source,
Wrangler template, and D1 migrations required by its own version. Setup must
not search for `apps/console` or `apps/expo-lynx-example` on the caller's disk.

### Interactive flow

```text
1. Check Node and invoke the CLI's bundled Wrangler dependency.
2. Open Wrangler browser authorization when no login exists.
3. Let the operator select one Cloudflare account.
4. Ask for a unique Worker name and Console username.
5. Create or reuse one D1 database and one private R2 bucket.
6. Open the selected account's R2 API-token page.
7. Prompt for an R2 S3 access-key ID and secret with Object Read & Write.
8. Generate the RSA deployment-signing keypair locally in memory.
9. Build/deploy the bundled Console and Worker.
10. Store the private key and generated auth values as Worker secrets.
11. Apply the bundled D1 migrations.
12. Write local connection files and print the Console URL.
```

The R2 S3 credential remains the only unavoidable Dashboard handoff because
mini-app machines upload directly to R2. Setup explains the exact bucket and
permission, opens the correct URL, and never calls it a general Cloudflare API
token.

Setup generates the signing keypair. It writes only the public key to disk and
sends the private key directly to `wrangler secret put` over stdin. It never
prints the private key or writes it into `.env.lynx`.

### Generated files

```text
.lynx/console.json                 safe resource identifiers; commit allowed
.env.lynx                          generated credentials; always ignored
keys/lynx/updates.public.pem       public mobile trust key; commit allowed
```

`.lynx/console.json` contains only bounded non-secret values needed for future
deploys: schema version, Cloudflare account ID, Worker name/URL, D1 database ID,
R2 bucket name, and CLI template version.

`.env.lynx` contains the Console username/password, Worker API key, and R2 S3
credential. Setup must add or verify an exact `.env.lynx` entry in `.gitignore`.
It must never overwrite an existing environment file or public key with
different values.

### Resume and update

Setup is phase-idempotent. If it stops after creating D1 or R2, rerunning reads
`.lynx/console.json`, confirms each exact resource, and continues. A conflicting
resource or credential fails with an actionable message. There is no destructive
`--force` setup mode in this version.

Setup updates `.lynx/console.json` atomically after each successful resource
creation so a terminated process can resume without guessing what was created.

After initial provisioning:

```bash
pnpm dlx --package expo-lynx-bundle-cli lynx console deploy
```

deploys the bundled Worker/Console version and applies only pending migrations.
It preserves D1 data, R2 objects, users, API keys, signing secrets, and the
Worker URL. It refuses a migration requiring destructive confirmation.

## Host runtime registration API

`lynx host register` reads the runtime retained in the prepared embedded
registry and calls:

```http
PUT /api/apps/:appId/runtime
authorization: Bearer <api-key>
content-type: application/json
```

```json
{
  "schemaVersion": 1,
  "runtimeVersion": "<opaque-host-runtime>",
  "appVersion": "1.2.0",
  "buildNumber": "42",
  "features": ["checkout", "merchant-home"]
}
```

The Worker validates this request with TypeBox using `additionalProperties:
false`. Controller validation confirms the app exists, every feature is a
registered child of that app, and the list exactly matches the host's prepared
registry. One D1 transaction creates missing disabled deployment rows and sets
the app's current runtime/build label. It never selects or enables a bundle.

Repeated identical registration returns success without revision changes.
Registering the same runtime with conflicting app/build metadata returns `409`.

## Mini-app upload protocol v2

This is an authenticated control protocol. It does not change the signed public
mobile deployment protocol.

### Local release files

```text
dist/lynx-releases/<releaseId>/
  release.json
  release.zip
```

`release.json` is unsigned upload metadata and contains no runtime or
fingerprint:

```json
{
  "schemaVersion": 2,
  "appId": "bs-one",
  "feature": "merchant-home",
  "releaseId": "merchant-home-20260905T120000Z-a1b2c3",
  "version": "2026.09.05",
  "archiveSha256": "<64-lowercase-hex-characters>",
  "archiveBytes": 344959
}
```

The Worker uses one TypeBox object with `additionalProperties: false`:

```ts
const MiniAppReleaseV2 = Type.Object({
  schemaVersion: Type.Literal(2),
  appId: Type.String({ pattern: '^[a-z][a-z0-9-]{0,63}$' }),
  feature: Type.String({ pattern: '^[a-z][a-z0-9-]{0,63}$' }),
  releaseId: Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' }),
  version: Type.String({ minLength: 1, maxLength: 128 }),
  archiveSha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  archiveBytes: Type.Integer({ minimum: 1, maximum: 64 * 1024 * 1024 })
}, { additionalProperties: false });
```

The controller additionally rejects control characters in `version` and keeps
all current ZIP, path, identifier, and size limits.

### Reserve upload

```http
POST /api/uploads
authorization: Bearer <api-key>
content-type: application/json
```

The Worker performs these operations in order:

```text
authenticate API key
  -> validate MiniAppReleaseV2
  -> require registered app and mini app
  -> require apps.current_runtime_version
  -> reserve immutable bundle against that exact runtime
  -> return target host-build label and upload state
```

Example response:

```json
{
  "schemaVersion": 2,
  "bundleId": "merchant-home-20260905T120000Z-a1b2c3",
  "target": {
    "appId": "bs-one",
    "feature": "merchant-home",
    "appVersion": "1.2.0",
    "buildNumber": "42"
  },
  "complete": false,
  "uploaded": false
}
```

The response does not expose the raw runtime. In local Worker mode it may also
contain the existing bounded local upload instruction. Production direct R2
upload continues using the CLI's local S3 credential.

Interactive release reserves the target, shows its app version/build number,
and asks for confirmation before R2 upload. Non-interactive release requires
`--host-build <buildNumber>` (or `LYNX_EXPECTED_HOST_BUILD`) and sends it as the
bounded `lynx-expected-host-build` registration header. The Worker compares it
before creating a reservation and returns `409 host-build-mismatch` when it is
not current.

The reservation stores the runtime and immutable release metadata before R2
upload with `verified_at = NULL`. It also retains the target app version/build
label so retries remain understandable after the app's current runtime changes.
The minimum migration is:

```sql
ALTER TABLE bundles ADD COLUMN verified_at TEXT;
ALTER TABLE bundles ADD COLUMN target_app_version TEXT;
ALTER TABLE bundles ADD COLUMN target_build_number TEXT;
```

New reservations require the target label in controller code; migrated existing
rows may leave it null. Do not add an upload-status enum or upload-session table.

An identical release ID and metadata resumes the original reservation. It never
uses a newer `apps.current_runtime_version`. Reusing the ID with different
metadata returns `409 bundle-conflict`.

### Direct R2 upload

The CLI uploads only `release.zip` to the server-constructed immutable key:

```text
<appId>/<feature>/releases/<releaseId>/release.zip
```

It uses `If-None-Match: *`, exact `Content-Type`, and the SHA-256 checksum
header. The Worker API key is never sent to R2; the R2 S3 credential is never
sent to the Worker or stored in the release directory.

### Complete upload

```http
POST /api/uploads/:bundleId/complete
authorization: Bearer <api-key>
content-type: application/json
```

The body is the same `MiniAppReleaseV2`. The Worker loads the original
reservation, compares every immutable field, HEADs the R2 object, verifies its
exact byte length and checksum, and sets `verified_at` once. It never reads the
current app runtime during completion.

Only rows with non-null `verified_at` can appear in Console bundle selection or
be attached to a deployment. Equal completion retries succeed. Missing or
mismatched R2 objects fail without making the bundle selectable.

### Upload errors

Use one JSON error shape:

```json
{
  "error": {
    "code": "host-runtime-not-registered",
    "message": "BS One has no registered current host build. Ask the host team to run lynx host register."
  }
}
```

Required stable codes are:

```text
unauthorized
invalid-request
app-not-found
mini-app-not-found
host-runtime-not-registered
host-build-mismatch
bundle-conflict
artifact-not-found
artifact-mismatch
```

Messages name the responsible team and next command without exposing a token,
fingerprint, signing key, R2 secret, D1 identifier, stack trace, or raw provider
response.

## Doctor contract

### Detection

`lynx doctor` walks upward from the current directory and runs every matching
profile:

```text
Console profile   .lynx/console.json
Host profile      Expo config containing expo-lynx-view
Mini-app profile  lynx-miniapp.config.*
```

A monorepo may match more than one profile. That is valid; doctor labels each
result rather than guessing one workspace type.

### Local checks

Default `lynx doctor` is read-only and performs no network request.

Console checks:

- `.lynx/console.json` schema and required resource IDs;
- `.env.lynx` exists, is ignored, and contains required names without printing
  values;
- public key parses as one supported SPKI RSA key;
- bundled template version is not older than the saved resource version.

Host checks:

- `expo-lynx-view` is installed and configured once;
- embedded path and public key exist inside the project;
- delivery endpoints are credential-free canonical URLs;
- all endpoints use one app ID and their feature keys match their URL paths;
- embedded registry is valid and matches those features;
- freshly calculated Expo fingerprint equals the prepared registry runtime;
- app version and build number are present for production registration.

Mini-app checks:

- config contains only scalar `appId` and `feature`;
- conventional `src/index.tsx` and `lynx.config.ts` exist inside the workspace;
- release output stays inside the workspace;
- Worker URL, API-key name, R2 account/bucket/access-key names are present for
  upload without printing their values;
- `.env.lynx` and release output are ignored.

Missing remote environment values are warnings during local-only doctor because
`release --draft` must remain usable offline. They become failures with
`doctor --remote` or before an actual upload.

### Remote checks

`lynx doctor --remote` first requires all local checks to pass, then performs
only bounded read-only requests:

- Console: Wrangler identity, exact Worker health, and configured resource
  existence;
- Host: API-key authentication, registered app/mini apps, and whether the
  prepared runtime equals the Worker's current host build;
- Mini app: API-key authentication, app/mini-app registration, current target
  host-build label, and one signed read-only R2 `ListObjectsV2` request with
  `max-keys=0` against the configured bucket.

Doctor must not create resources, register a runtime, reserve an upload, write
an R2 test object, update D1, rotate a secret, or modify configuration. There is
no `--fix` mode in this version.

### Output and exit status

Human output is short and actionable:

```text
✓ Mini app: bs-one / merchant-home
✓ Worker: authenticated
✗ R2 bucket name is missing
  Add LYNX_DELIVERY_R2_BUCKET to .env.lynx
```

Exit `0` when all checks pass or only warnings exist. Exit `1` when any required
check fails. `--json` returns ordered `{ profile, check, status, message }`
records and never includes environment values.

## Documentation work

D01 must document:

- setup from an empty operator repository;
- the one unavoidable R2 Dashboard credential step;
- generated safe versus secret files;
- initial setup versus later `console deploy`;
- the complete upload v2 sequence and target host-build label;
- local versus remote doctor behavior and example fixes.

The quick-start path ends by running `lynx doctor --remote` in the Console,
host, and mini-app workspace before the first release.

## Implementation order

1. Add the I01 app/mini-app registry, runtime registration, reservation fields,
   and TypeBox request schemas in the existing Worker/Drizzle code.
2. Migrate current uploads to protocol v2 while preserving completed legacy
   bundles and the public mobile protocol.
3. Package the existing Console/Worker assets and make setup/deploy independent
   of this monorepo.
4. Add host prepare/register and independent mini-app release commands.
5. Add the read-only doctor profiles and focused fixture tests.
6. Implement D01 in `apps/docs`, then remove planned-command warnings.

Do not publish the CLI or document protocol v2 as available until steps 1–5
pass together.

## Verification

```bash
pnpm --filter expo-lynx-bundle-cli lint
pnpm --filter expo-lynx-bundle-cli test
pnpm --filter @expo-lynx/delivery-console typecheck
pnpm --filter @expo-lynx/delivery-console test
pnpm docs:build
git diff --check
```

Tests use temporary fixture workspaces and mocked Cloudflare/R2 requests. They
must not deploy Cloudflare resources, mutate production data, run Expo prebuild,
CocoaPods, Xcode, a simulator, Gradle, or a native build.

## Acceptance criteria

- [ ] `pnpm dlx --package expo-lynx-bundle-cli lynx console setup` works outside this
      monorepo and can safely resume a partial setup.
- [ ] Setup opens Wrangler browser authorization, generates the signing pair,
      deploys the bundled template, migrates D1, and writes only documented
      local files.
- [ ] A later `console deploy` preserves URL, data, objects, users, and secrets.
- [ ] Mini-app upload metadata contains no runtime/fingerprint and the Worker
      reserves the current exact runtime before R2 upload.
- [ ] Runtime changes during upload or retry cannot rebind the release.
- [ ] Unknown app/mini-app and absent host runtime fail before R2 work.
- [ ] Only R2-verified reservations are selectable in the Console.
- [ ] `lynx doctor` catches malformed host endpoints, stale fingerprints,
      unknown mini apps, absent environment names, and remote auth failures
      without printing secrets or changing state.
- [ ] Console, host, and mini-app setup can be completed by following only
      `apps/docs`.

## Out of scope

- Cloudflare organization/team management, API-token creation, custom domains,
  multiple environments/channels, role-based access, secret rotation, automatic
  repair, browser bundle upload, multipart archives, and Android delivery.
