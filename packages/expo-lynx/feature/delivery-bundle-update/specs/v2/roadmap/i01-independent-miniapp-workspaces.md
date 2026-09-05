# I01 — Host-owned runtime, independent mini-app releases

**Status:** approved specification; implementation has not started.

## Problems to solve

1. A remote bundle built for one native `expo-lynx-view` runtime must never run
   in a different native runtime.
2. A mini-app team must be able to release from a separate repository without
   cloning the React Native host, generating an Expo fingerprint, or copying a
   fingerprint file.

## Decision

Keep `runtimeVersion` as an internal safety boundary. Remove it only from the
mini-app developer interface.

```text
Host repository                 Worker                    Mini-app repository
───────────────                 ──────                    ───────────────────
Expo/native inputs              registered apps           appId: bs-one
      │                         current host runtime       feature: merchant-home
      ▼                                  │                         │
@expo/fingerprint                        │                         ▼
      │                                  └────────────── pins release upload
      ├─ embedded in app binary                            to current runtime
      └─ registered by host release preparation
```

There are no generic cross-runtime bundles. Every completed bundle remains
bound to exactly one host runtime, but the Worker chooses that runtime during
upload registration. A mini-app developer never supplies it.

## Configuration ownership

### Console

An operator creates the allowed identities before either team can upload:

```text
BS One             id: bs-one
  Merchant Home    id: merchant-home
  Checkout         id: checkout
```

IDs are immutable. Display names are editable. A typo must return an error; it
must not silently create a new app or mini app.

### Host application

The Expo plugin owns only native embedding, trust, and public delivery URLs:

```json
[
  "expo-lynx-view",
  {
    "embeddedBundlesPath": "./generated/expo-lynx/embedded",
    "publicKeyPath": "./keys/lynx/updates.public.pem",
    "deliveryEndpoints": {
      "merchant-home": "https://delivery.example.com/v1/bs-one/merchant-home",
      "checkout": "https://delivery.example.com/v1/bs-one/checkout"
    }
  }
]
```

The host does not contain mini-app source paths, entries, Rspeedy configs, or
build commands.

### Mini-app repository

One repository owns one mini app:

```ts
import { defineMiniApp } from 'expo-lynx-bundle-cli';

export default defineMiniApp({
  appId: 'bs-one',
  feature: 'merchant-home'
});
```

The fixed conventions are `src/index.tsx` and `lynx.config.ts`. Do not add a
feature map, `entry`, `lynxConfig`, runtime, fingerprint path, or host checkout
path to this configuration.

## Runtime safety contract

### Host build

The host tooling calculates one deterministic `runtimeVersion` from the real
Expo/native project using `@expo/fingerprint`. The exact value is:

- written to the embedded registry;
- embedded into the native application by the Expo plugin; and
- optionally registered with the Worker by an explicit authenticated command.

Host registration verifies that the app and all embedded mini-app IDs already
exist, creates disabled deployment rows for the new runtime, and sets
`apps.current_runtime_version`. It also records the Expo app version and native
build number as a human-readable label. It never selects or enables a remote
bundle. The operation is idempotent.

Preparation is local-only by default:

```bash
pnpm lynx host prepare
```

`host prepare` assembles or validates the embedded baselines, computes the
fingerprint, writes the exact runtime into the registry consumed by the Expo
plugin, and makes no network request. The embedded registry is the prepared
runtime record; do not create a second fingerprint file. No Worker credential
is required. The command reads app version/build number from Expo configuration
and derives app/feature IDs from the validated delivery endpoints; none are
typed again.

After a successful manual native build, but before distribution, explicitly
register that exact prepared runtime:

```bash
pnpm lynx host register
```

`host register` recomputes the local fingerprint only to prove the project has
not changed since preparation. It sends the retained prepared value, not a new
value. It fails if the embedded registry, endpoint identities, or current
project fingerprint disagree.

CI may opt into a one-shot command:

```bash
pnpm lynx host prepare --register
```

Registration errors are fatal when explicitly requested. There is no implicit
network attempt and no silent fallback from requested registration to local-only
preparation.

If CI registers before its native build and that build later fails, new uploads
may target the not-yet-shipped runtime, but old devices remain on their previous
runtime and cannot receive those bundles. This fails closed. The normal manual
flow avoids that temporary state by registering only after the archive succeeds.

### Missing registration fails closed

A device always sends the runtime embedded in its own binary:

```http
GET /v1/bs-one/merchant-home
lynx-runtime-version: <host-runtime>
```

The Worker performs an exact `(appId, feature, runtimeVersion)` lookup. When no
row exists, it returns a signed disabled response for the requested runtime.
Mobile keeps the embedded bundle. It must never fall back to another runtime or
to `apps.current_runtime_version` during a device request.

Therefore forgetting host registration can make OTA unavailable, but cannot
cause a native mismatch.

The Worker never calculates an Expo fingerprint. It reads the current value
from the D1 `apps` row written by authenticated `host register` (or explicit
`host prepare --register`). It also never learns or changes the current runtime
from an unauthenticated mobile request.

### Mini-app release

The mini-app team runs:

```bash
pnpm lynx release
```

The generated release metadata contains app ID, feature ID, release ID,
version, archive hash, and archive size. It contains no fingerprint or
`runtimeVersion`.

Upload registration performs the binding:

```text
1. CLI builds and hashes release.zip.
2. CLI POSTs release metadata using its upload API key.
3. Worker validates the registered app and mini app.
4. Worker reads apps.current_runtime_version.
5. Worker reserves this immutable bundle for that exact runtime.
6. CLI uploads release.zip directly to R2.
7. Worker verifies R2 size/hash and marks the reserved bundle complete.
```

The reservation is required because the current host runtime may change while
R2 upload is in progress. Retrying the same release ID resumes the same runtime
reservation; it must never silently rebind to the new current runtime.

The CLI response names the target as, for example, `BS One 1.2.0 (build 42)`.
It does not print the raw fingerprint. If the displayed build is not the one the
mini-app team intends to support, the upload stops before R2 unless explicitly
confirmed in an interactive terminal; CI requires an expected host-build label
and fails on mismatch.

Only completed bundles appear in the Console or can be selected. The Console
may select a bundle only for its reserved runtime. It cannot copy or promote a
bundle across runtimes.

The exact request, reservation, completion, error, setup, and diagnostic
contracts are defined by [I02 — Console setup, upload, and doctor](i02-console-setup-upload-doctor.md).

## Minimal data model

Add explicit app identity and one nullable bundle completion timestamp. Keep
the existing runtime-scoped deployment table.

```sql
CREATE TABLE apps (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  current_runtime_version TEXT,
  current_app_version TEXT,
  current_build_number TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE mini_apps (
  app_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (app_id, id)
);

-- Existing bundles table retains runtime_version and remembers the label shown
-- when its upload was reserved.
ALTER TABLE bundles ADD COLUMN verified_at TEXT;
ALTER TABLE bundles ADD COLUMN target_app_version TEXT;
ALTER TABLE bundles ADD COLUMN target_build_number TEXT;

-- Existing deployment identity remains:
-- PRIMARY KEY (app_id, feature_id, runtime_version)
```

`verified_at IS NULL` means the R2 upload is reserved but not yet verified. The
two nullable target fields preserve the non-secret label shown to uploaders and
may be null only for migrated legacy rows. No upload-status enum, runtime table,
channel, environment, role, or compatibility table is needed.

## Console experience

```text
Apps
  └─ BS One
      └─ Merchant Home
          ├─ Current host build
          ├─ Compatible completed bundles
          └─ Selected / enabled / force controls
```

The normal UI says **Current host build** and does not ask anyone to type or
choose a fingerprint. The raw runtime value may be shown only in collapsed
diagnostics.

Older runtime deployment rows and their selected bundles remain available to
older installed binaries. New releases target only the current host build in
this MVP.

## Cross-team native upgrade example

```text
Before upgrade
  Host v1 embeds Merchant Home M1
  Host runtime = A
  Remote M2 is selected only for A

Host team upgrades expo-lynx-view / native Lynx
  Host release preparation embeds an approved immutable Merchant Home artifact
  @expo/fingerprint produces B
  Host team explicitly registers B with disabled delivery

Users install Host v2
  Device asks for B
  No selected B release exists yet
  Device uses the B build's embedded Merchant Home safely

Mini-app team runs pnpm lynx release
  Worker reserves M3 for current runtime B
  Console tests and selects M3 for B

Result
  Host v1 devices continue asking for A and may receive M2
  Host v2 devices ask for B and may receive M3
  M2 can never be returned to B
```

The host consumes a pinned, immutable mini-app build artifact for its embedded
baseline; it never imports mini-app source. How teams transport that build
artifact (existing R2 release, CI artifact, or package registry) does not alter
the runtime protocol. The chosen release ID and SHA-256 must be retained by the
host build so it is reproducible.

Credential ownership stays separate:

- host release automation has the Worker API key needed to register its runtime;
- mini-app CI has an upload API key and direct R2 object-write credentials;
- the shipped mobile app has no control credential and trusts only the embedded
  deployment-signing public key.

## Implementation tasks

### 1. Registry and migration

- Add the `apps` and `mini_apps` Drizzle tables and one D1 migration.
- Seed distinct existing app/feature identities before enforcing registration.
- Add `bundles.verified_at`; mark existing valid rows verified during migration.
- Keep `bundles.runtime_version` and runtime-scoped deployments.
- Add authenticated list/create app and mini-app routes.

### 2. Host runtime registration

- Keep `@expo/fingerprint` only in host-side tooling.
- Generate one runtime and use it for the embedded registry and native config.
- Add one idempotent authenticated host-registration command/API.
- Implement local-only `lynx host prepare`, explicit `lynx host register`, and
  one-shot `lynx host prepare --register`.
- Make `host register` reject changes since preparation and make an explicitly
  requested registration failure fatal.
- Read the app version/build number from Expo config and show that label to
  uploaders instead of the raw fingerprint.
- Never register from an unauthenticated device request.

### 3. Independent mini-app CLI

- Replace the host-owned `features` map with scalar `appId` and `feature`.
- Use the conventional `src/index.tsx` and `lynx.config.ts` files.
- Remove fingerprint generation, embedded-registry reads, and runtime flags
  from mini-app build/release commands.
- Let upload registration reserve the current runtime before direct R2 upload.
- Keep retries bound to the original reservation.
- Publish the CLI as the unscoped `expo-lynx-bundle-cli` package.

### 4. Worker and Console

- Reject unknown app/mini-app IDs before creating an R2 object.
- Hide unverified reservations from deployment selection.
- Prevent selection when bundle and deployment runtimes differ.
- Replace the scope picker with `Apps -> mini apps -> current host build`.
- Preserve signing, revision, ETag, enable, disable, and force behavior.
- Complete the I02 setup, upload-v2, and doctor contract.

### 5. Documentation

- Complete [D01 — Cross-team integration documentation](d01-cross-team-integration-docs.md).
- Keep package READMEs short and make `apps/docs` the canonical workflow.

## Acceptance criteria

- [ ] A native change creates a different runtime and cannot see bundles from
      the previous runtime.
- [ ] An unknown runtime receives signed disabled state and uses embedded
      content; the Worker never substitutes its current runtime.
- [ ] A standalone mini-app repository builds and uploads without the host
      source, Expo fingerprint JSON, or a runtime argument.
- [ ] Upload registration pins the bundle to the Worker's current host runtime,
      and retry cannot change that binding.
- [ ] The Console cannot select an incomplete or differently scoped bundle.
- [ ] Unknown or mistyped app/mini-app IDs fail before R2 upload.
- [ ] Old and new host binaries can concurrently receive their own exact
      deployments from one Worker.
- [ ] `host prepare` makes no network request; only `host register` or
      `host prepare --register` changes Worker state.
- [ ] Manual registration uses the exact prepared runtime and rejects native or
      configuration changes made after preparation.
- [ ] Mobile's existing signed runtime, cache isolation, revision, enabled,
      force, and archive verification behavior remains unchanged.

## Known ceiling

Exact runtime binding prevents a release from crossing native host builds. It
cannot prove that arbitrary new mini-app source uses only APIs supported by
that host. In this MVP, testing on the current host build plus explicit Console
promotion is that approval. Add a formal shared mini-app SDK/API contract only
when the host exposes versioned custom native APIs that require it.
