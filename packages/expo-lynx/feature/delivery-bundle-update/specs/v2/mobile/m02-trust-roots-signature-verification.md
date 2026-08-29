# M02 — Expo iOS build integration, trust root, and RSA-SHA256 verification

**Spec:** `feature/delivery-bundle-update/specs/v2/mobile/m02-trust-roots-signature-verification.md`

## Goal

Give an Expo app two simple native-build inputs:

1. one generated directory containing the static embedded baseline for every
   declared mini-app; and
2. one app-wide RSA public key used to authenticate every remote Lynx update.

The Expo config plugin validates and embeds both inputs for iOS. Swift verifies
signed V2 envelopes with the public key before executable remote bytes are
trusted. The plugin never accepts a private key. Android integration is
preserved in the development roadmap, not implemented by this spec.

## Depends on

- [M01 — Shared release protocol](m01-shared-release-protocol.md).
- [S01 — Build, embedded baseline, and signing CLI](../server/s01-build-package-sign.md).

For native verification tests, S01 provides platform-neutral development
fixtures in `../../fixtures/v2/crypto-development/`: the public SPKI key and
signed channel/release envelopes. The corresponding private key is deliberately
not present in the repository. Use the payload bytes embedded in those envelopes
as the exact verification input; do not parse and reserialize the JSON first.

## Files

- `packages/expo-lynx/app.plugin.js`
- iOS plugin tests for path resolution, Xcode resources, and secret rejection
- `packages/expo-lynx/ios/LynxSignatureVerifier.swift` — new
- iOS native unit tests using the M01 fixtures
- `apps/expo-lynx-example/app.json`
- example/root ignore rules for local private keys and generated output, based
  on the repository's selected CI strategy

This task copies and validates iOS embedded resources. M04 resolves the registry
during fallback/activation. Android resource/signature work is A01 in the
development roadmap.

## User-facing Expo configuration

```json
{
  "expo": {
    "plugins": [
      [
        "expo-lynx",
        {
          "embeddedBundlesPath": "./generated/expo-lynx/embedded",
          "publicKeyPath": "./keys/lynx/updates.public.pem"
        }
      ]
    ]
  }
}
```

Both paths resolve relative to the consuming Expo app's project root obtained
from the config-plugin mod request. Application code must not call
`readFileSync`, inline PEM text, list feature scopes, or select keys.

### Why one app-wide key

V2 starts with the same simple trust model used by established mobile updater
configuration: one publisher trust root per native host. The key authenticates
updates for all mini-apps declared in that host's embedded registry.

- `shopping`, `orders`, and other declared features share the same public key.
- Authorization is still bound to a mini-app because the signed payload contains
  an explicit `type` and `feature`, and native verification requires the payload
  feature to equal the requested feature.
- The app does not configure `keyId`, `role`, `featureIds`, or PEM content.
- If diagnostic/audit code needs a key identifier, derive it from
  `base64url(SHA-256(DER SubjectPublicKeyInfo))`; it is metadata, not an
  additional trust decision.

This intentionally accepts a larger compromise blast radius in exchange for a
much smaller V1 configuration and operational surface. Multiple trust domains,
overlapping keys, per-feature keys, and separate release/channel signers are a
future protocol version, not hidden V2 options.

## RSA-SHA256 versus SHA-256

SHA-256 alone is a checksum: anyone who changes a bundle can calculate a new
checksum. RSA-SHA256 is a digital signature: the publisher signs exact payload
bytes with the private RSA key, and the app verifies them with the embedded
public key. The system uses both:

- RSA-SHA256 proves publisher authorization of the channel/release payload.
- SHA-256 hashes bind that authorized payload to the exact ZIP and extracted
  files.

TLS remains required. Signatures preserve end-to-end authenticity across
caches/CDNs and protect against a compromised storage origin serving newly
invented executable bytes.

## Generate a local/test key pair

S01 owns the project CLI. Before it lands, OpenSSL 3 may generate one 3072-bit
RSA pair:

```bash
umask 077
mkdir -p .local-lynx-keys

openssl genpkey \
  -algorithm RSA \
  -pkeyopt rsa_keygen_bits:3072 \
  -pkeyopt rsa_keygen_pubexp:65537 \
  -out .local-lynx-keys/updates.private.pem

openssl pkey \
  -in .local-lynx-keys/updates.private.pem \
  -pubout \
  -out apps/expo-lynx-example/keys/lynx/updates.public.pem
```

Expected file formats:

```text
private key: PKCS#8 PEM; secret; publisher-only; never commit
public key:  SPKI PEM; safe to embed in the app
```

Validate without printing private components:

```bash
openssl pkey \
  -in .local-lynx-keys/updates.private.pem \
  -check \
  -noout

openssl pkey \
  -pubin \
  -in apps/expo-lynx-example/keys/lynx/updates.public.pem \
  -pubcheck \
  -noout
```

`.local-lynx-keys/**` must be ignored. Only the public file may be placed in
the Expo app and committed. Production private keys are generated/imported by
the restricted CI/KMS/secret workflow in S01, not on a developer laptop.

## `publicKeyPath` plugin contract

- Require one non-empty relative path. Reject arrays, inline PEM, absolute
  paths, URLs, NUL bytes, and lexical escape from the Expo app project root.
- Resolve symlinks with `realpath` and reject a real target outside the app
  project root.
- Require a regular UTF-8 file no larger than 16 KiB whose filename ends with
  `.public.pem`.
- Accept exactly one `BEGIN PUBLIC KEY` SubjectPublicKeyInfo block. Reject
  certificates, multiple blocks, encrypted PEM, and every private-key marker.
- Parse and enforce RSA, modulus at least 3072 bits, and exponent 65537.
- Normalize CRLF to LF and one trailing newline before native generation.
- Compute the SPKI fingerprint for diagnostics without printing PEM contents.
- Missing/invalid public key is a Release prebuild failure. Local unsigned
  development remains possible only behind the explicit internal/Debug guard.

Changing the public-key file or its path requires Expo prebuild/config
generation and a new native host release. Repacking a bundle signed by the
already trusted private key does not require prebuild.

## `embeddedBundlesPath` plugin contract

- Resolve and contain the path with the same Expo-app-root rules as the public
  key. Reject URLs, symlink escape, and non-directory input.
- Require S01 `registry.json`, every declared `baseline.json`, exactly one
  `main.lynx.bundle` per feature, and all referenced sidecars.
- Revalidate registry/path containment, feature-key rules, exact declared file
  set, file sizes, and SHA-256 during prebuild. This is build-time work and may
  be expensive; it must never run on each app/mini-app open.
- Fail prebuild on missing, malformed, partial, or inconsistent generated
  output. The plugin must never fall back to an unrelated generic
  `static.lynx`.
- Copy exactly once into a dedicated native namespace, preserving relative
  feature directories:

```text
iOS application resources/
  ExpoLynxEmbedded.bundle/
    registry.json
    shopping/baseline.json
    shopping/main.lynx.bundle
    shopping/static/**

```

- Do not place the source under Expo `assets/`, do not generate React Native
  `require()` calls, and do not send it through Metro's asset graph.
- Make the iOS copy idempotent: repeated prebuild does not duplicate Xcode
  resource groups or build phases.
- Do not add partial Android resource/signature behavior in this milestone;
  preserve it for A01 in `DEVELOPMENT-ROADMAP.md`.
- Deprecate the generic `bundledResources` option for this use case. Once the
  generated registry path is active in the sample, remove its
  `assets/static.lynx` and `assets/static` entries to prevent duplicate app
  size.

Embedded baseline bytes remain in the read-only app package. Do not copy them
into the writable remote cache on first run. Their authenticity is inherited
from native app signing, and runtime lookup performs only bounded registry/path
checks.

## Migration from the current sample prototype

1. Move/copy each Lynx feature source into a reproducible monorepo directory
   selected by S01 canonical feature-key resolution.
2. Add `lynx-bundle.config.ts` and run `build-embedded` to generate the registry
   tree.
3. Add the public test/production-appropriate SPKI file to the Expo app and set
   `publicKeyPath` plus `embeddedBundlesPath`.
4. Run prebuild and confirm the dedicated native resource namespaces exist.
5. Remove the sample's `bundledResources: ['./assets/static.lynx',
   './assets/static']` configuration and old duplicate assets.
6. M04 replaces the current feature-to-`<feature>.lynx`/generic
   `static.lynx` runtime lookup with exact registry lookup.

Steps 1–5 require a native host rebuild. After that, rebuilding/signing a remote
ZIP for an existing compatible feature does not require prebuild.

## Native signature-verification contract

- Support only envelope `schemaVersion: 1` and algorithm `RSA-SHA256`.
- Decode `payload` and `signature` strictly from unpadded base64url.
- Verify the signature over the exact decoded payload bytes using iOS Security
  `SecKeyAlgorithm.rsaSignatureMessagePKCS1v15SHA256`.
- Parse the payload only after signature verification succeeds.
- Require `payload.type` to match the caller's expected document type
  (`lynx-channel` or `lynx-release`). This prevents a valid release payload from
  being accepted as a channel pointer, or vice versa, even though one key signs
  both.
- Require signed `payload.feature` to equal the validated feature requested by
  the host before using any URL, cache path, or state namespace.
- Return stable errors for missing/invalid embedded key, malformed envelope,
  unsupported algorithm/version, base64 failure, signature failure, wrong
  document type, and feature mismatch.
- Never perform network key discovery or accept a public key from the signed
  response itself.

## Rotation model for V2

V2 embeds one active public key. Normal rotation is deliberately native-release
gated:

1. Generate a new pair in the restricted signing environment.
2. Ship a new native host containing the new public key while the service still
   signs with the old private key.
3. After the adoption threshold is explicitly accepted, switch the signer to
   the new private key.
4. Old host versions keep their embedded/LKG content but stop accepting new
   releases; they must fail safely, never discover a replacement key remotely.

Emergency compromise response stops signing/promotion immediately and ships a
new host trust root. Supporting simultaneous old/new signatures for long
overlap is deferred rather than adding a hidden key registry to this V2 config.

## Acceptance criteria

- [ ] Plain `app.json` config with `embeddedBundlesPath` and `publicKeyPath`
      works without application-side file reads or inline PEM.
- [ ] The same config resolves from monorepo root, app directory, and EAS-style
      invocation because paths use the mod-request project root.
- [ ] Prebuild embeds one public key, never a private key.
- [ ] Prebuild copies every configured feature baseline exactly once into the
      dedicated iOS namespace and rejects a stale/partial registry.
- [ ] No generated embedded baseline is present in Metro/Expo normal assets.
- [ ] The same valid M01 fixture verifies in TypeScript and Swift; the fixture
      remains platform-neutral for future Kotlin A01.
- [ ] One-bit payload/signature mutations fail.
- [ ] A signed channel payload cannot be accepted as a release payload or vice
      versa.
- [ ] A valid `shopping` payload cannot authorize an `orders` request/path.
- [ ] Release builds reject unsigned or wrongly signed remote envelopes.
- [ ] Existing raw/local unsigned testing remains explicitly internal-only.
- [ ] Changing only a remote bundle needs no prebuild; changing the public key,
      embedded registry, or feature set requires a host rebuild.

## Required verification

```bash
pnpm run test
pnpm run lint
pnpm run build
pnpm --filter expo-lynx-example exec expo prebuild
```

Also:

- run iOS native signature fixtures;
- inspect generated Info.plist and `ExpoLynxEmbedded.bundle` resources;
- inspect the production Metro bundle and native package for duplicate Lynx
  baselines;
- test missing/traversal/symlink/directory/oversized/malformed/certificate/
  private-key paths and malformed/partial embedded registries;
- verify private-key markers and `.local-lynx-keys/**` are absent from tracked
  files and native build output.

## Out of scope

- Production secret provisioning and signing automation (S01).
- Runtime embedded fallback/activation policy (M04).
- Downloading or extracting remote archives (M03).
- Android Expo resources/Kotlin verification (roadmap A01) and runtime delivery
  (roadmap M05).
- Multiple trust domains, per-feature keys, or overlapping key registries.
- Certificate pinning.
