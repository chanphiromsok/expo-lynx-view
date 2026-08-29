# M01 — Shared release protocol and fixtures

**Spec:** `feature/delivery-bundle-update/specs/v2/mobile/m01-shared-release-protocol.md`

## Goal

Define one versioned wire contract for channel pointers, release manifests,
archives, files, limits, activation, and signed envelopes. TypeScript tests and
checked-in fixtures become the source used by Swift, producer, and Worker specs;
their byte format remains platform-neutral for future Android work.

## Depends on

None. Read the current architecture first.

## Files

- `packages/expo-lynx/src/ReleaseProtocol.ts` — new
- `packages/expo-lynx/src/index.ts` — export public protocol types
- `packages/expo-lynx/src/__tests__/ReleaseProtocol.test.ts` — new
- `packages/expo-lynx/feature/delivery-bundle-update/fixtures/v2/` — new fixture set

## Contract

Signed objects use exact payload bytes, avoiding JSON canonicalization:

```ts
type SignedEnvelope = {
  schemaVersion: 1;
  algorithm: 'RSA-SHA256';
  payload: string;   // base64url UTF-8 JSON bytes
  signature: string; // base64url signature over decoded payload bytes
};
```

For this protocol, the `RSA-SHA256` string is normative shorthand for
RSASSA-PKCS1-v1_5 with SHA-256 over the decoded payload bytes. It is not RSA-PSS
and is not a plain SHA-256 checksum. Require an RSA modulus of at least 3072
bits and public exponent 65537. Public keys use PEM-encoded X.509 SubjectPublicKeyInfo;
signing-side private keys use PEM PKCS#8. Cross-language fixtures must prove the
equivalent platform algorithms:

- Node/Worker: `RSA-SHA256` with PKCS#1 v1.5 padding selected explicitly.
- iOS: `SecKeyAlgorithm.rsaSignatureMessagePKCS1v15SHA256`.
- Future Android/JCA mapping is reserved as `SHA256withRSA`, but Kotlin/native
  Android implementation is not required in the current milestone.

The decoded channel payload contains `type: 'lynx-channel'`, `feature`,
`channel`, monotonic `revision`, `releaseId`, `manifestUrl`, `manifestSha256`,
`runtimeVersion`, `activation`, `force`, `issuedAt`, and optional `expiresAt`.

The decoded release payload contains `type: 'lynx-release'`, `feature`,
`releaseId`, display `version`, `platform`, compatibility fields, archive
format/size/hash/expanded limits, and an exact file list. `main.lynx.bundle` is
required exactly once.

The explicit signed `type` is mandatory domain separation because V2 uses one
app-wide signing key for both document kinds. A caller must state the expected
document type and feature before verified payload data is used. A valid
release payload can never substitute for a channel pointer, and a valid payload
for one feature can never select another feature's URL, cache, or state.

Defaults:

```text
max archive bytes:            64 MiB
max uncompressed bytes:      256 MiB
max single entry bytes:       64 MiB
max entries:                    4096
max compression ratio:          100
max UTF-8 path bytes:            512
max path depth:                   16
```

Host applications may lower limits but cannot exceed compiled hard ceilings
without a native release.

## Requirements

- Validate safe feature/channel/release identifiers. Feature IDs follow
  `^[a-z][a-z0-9-]{0,63}$` and are the same canonical keys defined by S01.
- Validate HTTP(S) production URLs and safe relative artifact URLs.
- Reject duplicate normalized file paths, absolute paths, backslashes, empty
  components, `.` and `..`.
- Require positive sizes and 64-character hexadecimal SHA-256 values.
- Require archive `entryCount` and `uncompressedBytes` to agree with the file
  contract, with directories treated consistently.
- `force` cannot select a new safety mode; it only changes activation timing.
- Export parser functions returning typed results/errors, not unchecked casts.
- Include valid and invalid fixture envelopes/payloads without production
  private keys or credentials. Test fixtures may use an unmistakably
  development-only key pair whose private half never ships in app resources.

## Acceptance criteria

- [ ] Valid channel and release payload fixtures parse deterministically.
- [ ] Unknown `schemaVersion`, algorithm, activation, or archive format fails.
- [ ] Missing/unknown/wrong `type` and requested-feature mismatch fail after
      signature verification and before payload URLs/state are used.
- [ ] Duplicate, traversal, absolute, backslash, and oversized paths fail.
- [ ] Missing or multiple `main.lynx.bundle` entries fail.
- [ ] Invalid revision, timestamps, hashes, sizes, ratios, and entry counts fail.
- [ ] Base64url decoding is strict and rejects padding/invalid alphabet according
      to the documented encoding rule.
- [ ] Fixtures are usable without TypeScript runtime dependencies by Swift and
      Worker tests and remain portable for the Android roadmap.

## Required verification

```bash
pnpm run test
pnpm run lint
pnpm run build
```

## Out of scope

- Producer signing and ZIP creation (S01)
- Native signature verification (M02)
- ZIP extraction/installation (M03; Android roadmap M05 later)
- Network requests and storage
