# S01 — Multi-app build, embedded baseline, remote package, and signing CLI

**Spec:** `feature/delivery-bundle-update/specs/v2/server/s01-build-package-sign.md`

## Goal

Implement one `lynx-bundle` package/CLI that owns the complete producer-side
artifact pipeline: resolve a configured feature, run its isolated Rspeedy build,
generate native embedded baselines, create deterministic remote ZIP releases,
generate one app-wide RSA key pair for local/test use, and sign exact release or
channel payload bytes.

## Why these tasks are merged

Build, embedded output, ZIP packaging, and signing consume the same feature
configuration and exact artifact bytes. Splitting them previously left unclear
handoffs such as who selected `main.lynx.bundle`, who created the payload bytes,
and whether the signer reserialized JSON. One package now owns that boundary.

## Depends on

- [M01 — Shared release protocol](../mobile/m01-shared-release-protocol.md).
- Existing Rspeedy production builds and current local rebuild scripts.

## Owned files

- new reusable package, preferably `packages/lynx-bundle-cli`
- `lynx-bundle.config.ts` and config types/loader
- build, embedded registry, deterministic ZIP, key, and signing modules
- shared valid/malicious fixtures for TypeScript, Swift, and Worker; keep byte
  formats portable for the Android roadmap
- at least two fixture/example mini-apps

M02 consumes the embedded tree, public key, and signed fixtures. S02 consumes
the signed remote release output. This spec does not copy files into native
projects or upload anything.

## Configuration contract

The feature-map key is canonical; do not repeat `featureId` or configure a
per-feature `projectRoot`.

```ts
import { defineConfig } from 'expo-lynx-bundle-cli';

export default defineConfig({
  // Optional; defaults to the config directory.
  featuresDir: './features',

  features: {
    shopping: {},
    orders: { entry: './src/main.tsx' },
    profile: { lynxConfig: './config/lynx.config.ts' },
  },

  // Dedicated native-resource input; never normal Expo assets.
  embeddedOutputDir: './generated/expo-lynx/embedded',

  signing: {
    privateKeyPath:
      process.env.LYNX_SIGNING_PRIVATE_KEY_PATH ??
      './.local-lynx-keys/updates.private.pem',
  },
});
```

The exact source-root rule is:

```text
featureProjectRoot = resolve(configDirectory, featuresDir ?? '.', featureId)
```

The feature key must match `^[a-z][a-z0-9-]{0,63}$`. Reject case-insensitive or
normalized-path collisions. The same key names the source directory, embedded
registry entry, React Native feature, native cache namespace, server feature,
R2 prefix, and signed payload feature.

Resolve `entry` and `lynxConfig` inside the derived feature root, including
realpath/symlink containment. Defaults are `./src/index.tsx` and
`./lynx.config.ts`. The entry is compiled by Rspeedy; it is not run as a Node
script. Rspeedy must produce exactly one `main.lynx.bundle` plus its isolated
sidecars.

## Commands

Provide commands equivalent to:

```text
lynx-bundle build <feature>
lynx-bundle build-embedded [feature...] --runtime-version <version>
lynx-bundle check-embedded --runtime-version <version>
lynx-bundle pack <feature> --release-id <id> --version <version> \
  --platform ios --runtime-version <version>
lynx-bundle keys generate --output-dir <directory>
lynx-bundle sign-release <release-payload.json>
lynx-bundle sign-channel <channel-payload.json>
```

All commands resolve the config relative to the config file, not
`process.cwd()`. A developer running from the repository root, app directory,
or CI gets the same resolution.

## Phase A — Isolated feature build

- Run an independent Rspeedy production build per feature in transaction/cache
  staging such as `node_modules/.cache/expo-lynx/<transaction>`.
- Never use one multi-entry build across mini-apps; each feature needs isolated
  resources, identity, failures, and cache lifecycle.
- Allow only `main.lynx.bundle` and declared sidecars in publishable output.
- Exclude source maps, caches, dotfiles, debug artifacts, and unrelated files.
- A failed build cannot replace the last complete embedded or remote output.

## Phase B — Embedded baseline tree

Generate outside Expo normal assets:

```text
<embeddedOutputDir>/
  registry.json
  shopping/
    baseline.json
    main.lynx.bundle
    static/**
  orders/
    baseline.json
    main.lynx.bundle
    static/**
```

Normative metadata:

```ts
type EmbeddedRegistryV1 = {
  schemaVersion: 1;
  runtimeVersion: string;
  features: Record<string, {
    baseline: string;
    entry: string;
  }>;
};

type EmbeddedBaselineV1 = {
  schemaVersion: 1;
  feature: string;
  runtimeVersion: string;
  entry: 'main.lynx.bundle';
  inputFingerprint: string;
  files: Array<{
    path: string;
    bytes: number;
    sha256: string;
  }>;
};
```

Serialize feature keys and file lists lexicographically. File metadata covers
runtime files and excludes `baseline.json` to avoid self-hashing. Registry paths
are relative to the generated root; file paths are relative to the feature
directory. Reject URLs, absolute paths, traversal, symlinks, undeclared files,
and missing entries.

Build and validate the complete new tree, then atomically replace the whole
`embeddedOutputDir`. `check-embedded` recomputes source/config fingerprints and
fails on stale, missing, mixed, malformed, or wrong-runtime output.

## Phase C — Deterministic remote ZIP

Start from the same validated isolated build output. ZIP is remote transport
only; embedded native resources remain expanded.

- Normalize entry paths to forward-slash relative paths and sort them.
- Normalize timestamps, ownership, permissions, and nondeterministic metadata.
- Reject absolute/traversal/backslash paths, duplicates, collisions, symlinks,
  hard links, devices, encryption, unsupported compression, and unexpected
  files.
- Apply all M01 archive, expansion, entry, ratio, path, and count limits.
- Include exact installed path, byte size, and SHA-256 for every file in the
  release payload; require `main.lynx.bundle` exactly once.
- Identical source/config/release/version/runtime inputs must produce identical
  ZIP and payload bytes.

Output:

```text
dist/lynx-releases/<feature>/<releaseId>/
  release.zip
  release-payload.json
  release-envelope.json
  packaging-report.json
```

`release-payload.json` contains exact unsigned bytes with
`type: 'lynx-release'`. The report contains hashes/sizes but no secret.

## Phase D — One app-wide RSA signing identity

V2 uses one RSA key pair for all declared mini-apps and both document types.
There is no configured `keyId`, role, or `featureIds` list.

- RSA modulus is at least 3072 bits, exponent 65537.
- `RSA-SHA256` means PKCS#1 v1.5 with SHA-256, not PSS and not a plain hash.
- Sign the exact existing payload bytes; never parse and reserialize them.
- `sign-release` requires signed payload type `lynx-release`.
- `sign-channel` requires signed payload type `lynx-channel`.
- Both require a safe canonical feature before signing.
- Signature encoding is unpadded base64url.
- If an audit identifier is needed, derive
  `base64url(SHA-256(DER SubjectPublicKeyInfo))`.

`keys generate` writes `updates.private.pem` as PKCS#8 and
`updates.public.pem` as SPKI, uses owner-only private permissions, validates the
pair, refuses overwrite, and never prints private PEM. Private keys remain in
ignored local storage, CI secrets, Worker secrets, or KMS/HSM integrations;
they never enter Git, app resources, D1, R2, logs, telemetry, or reports.

## Rotation

V2 has one embedded public key and no transparent overlap:

1. Generate/import the new pair in the restricted environment.
2. Ship a host release embedding the new public key while still signing with
   the old key.
3. At an approved adoption point, switch release and channel signers together.
4. Old hosts retain embedded/LKG content but reject new signatures safely.

Emergency compromise disables signing/promotion, ships a new native trust root,
and never attempts remote trust bootstrap with the compromised channel.

## Build and migration boundary

- Native build: `build-embedded` → `check-embedded` → Expo prebuild → native
  build.
- Remote publish: `build` → `pack` → `sign-release` → S02 upload. No prebuild
  is required for an existing compatible feature.
- Adding/renaming/removing a feature or changing an embedded baseline/key needs
  a native host release.
- Feature sources must exist inside the EAS-submitted repository; sibling
  developer-machine paths are not reproducible inputs.

## Acceptance criteria

- [ ] `{ shopping: {} }` derives the `shopping` project root with no repeated
      ID/root configuration.
- [ ] Two features build independently with no resource namespace collision.
- [ ] Embedded generation is atomic, outside Expo assets, deterministic, and
      fails when stale.
- [ ] Remote packaging is byte-identical across repeated equal-input runs.
- [ ] One changed bundle byte changes file/archive hashes and signed input.
- [ ] Valid and malicious fixtures cover traversal, duplicates, symlinks,
      limits, missing entry, corruption, and unsupported ZIP features.
- [ ] The CLI generates one key pair safely and refuses overwrite/test-key use
      in production mode.
- [ ] TypeScript signatures are consumable by M02 Swift fixtures and remain
      platform-neutral for future Kotlin A01.
- [ ] Wrong payload type/feature, mutated bytes/signature, weak key, or malformed
      input fails closed.
- [ ] No private key or secret appears in tracked/generated output or logs.

## Required verification

- Run package typecheck, lint, and unit/integration tests.
- Build/check two embedded features from multiple working directories.
- Package the same fixture twice and compare exact bytes/SHA-256.
- Generate a pair in a temporary directory and inspect permissions/markers.
- Verify release/channel valid, wrong-type, wrong-feature, and mutation fixtures.
- Hand valid/malicious ZIP fixtures to M03; preserve the same corpus for
  roadmap M05.

## Out of scope

- Expo/native resource copying and mobile verification (M02).
- Worker upload/storage (S02) and channel operations (S03).
- Android platform publication/device verification, delta packages, production
  deployment, and multiple trust roots.
