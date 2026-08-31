# M01 — Shared release and deployment protocol

**Spec:** `feature/delivery-bundle-update/specs/v2/mobile/m01-shared-release-protocol.md`

## Goal

Define one platform-neutral signed wire contract for feature deployment state,
release manifests, archives, files, and safety limits. TypeScript tests and
checked-in fixtures are shared by the CLI, Worker, Swift, and future Android
implementation.

The pre-production `lynx-channel` contract is replaced by one
`lynx-deployment` payload per feature. There is no channel, activation mode, or
rollout field. One `force` boolean controls application timing.

## Depends on

None. Read the current architecture first.

## Files

- `packages/expo-lynx/src/ReleaseProtocol.ts`
- `packages/expo-lynx/src/index.ts`
- `packages/expo-lynx/src/__tests__/ReleaseProtocol.test.ts`
- `packages/expo-lynx/feature/delivery-bundle-update/fixtures/v2/`

## Contract

Signed objects preserve exact payload bytes and do not require JSON
canonicalization:

```ts
type SignedEnvelope = {
  schemaVersion: 1;
  algorithm: 'RSA-SHA256';
  payload: string;   // unpadded base64url UTF-8 JSON bytes
  signature: string; // unpadded base64url signature over decoded payload bytes
};
```

`RSA-SHA256` means RSASSA-PKCS1-v1_5 with SHA-256 over the decoded payload
bytes. Require an RSA modulus of at least 3072 bits and public exponent 65537.
Public keys use PEM X.509 SubjectPublicKeyInfo; signing private keys use PEM
PKCS#8.

Equivalent platform algorithms are:

- Node/Worker: `RSA-SHA256` with PKCS#1 v1.5 padding selected explicitly.
- iOS: `SecKeyAlgorithm.rsaSignatureMessagePKCS1v15SHA256`.
- Future Android: `SHA256withRSA`.

### Deployment payload

The deployment payload is a discriminated union:

```ts
type DeploymentPayloadV1 =
  | {
      type: 'lynx-deployment';
      feature: string;
      revision: number;
      enabled: false;
      issuedAt: string;
    }
  | {
      type: 'lynx-deployment';
      feature: string;
      revision: number;
      enabled: true;
      releaseId: string;
      manifestUrl: string;
      manifestSha256: string;
      force: boolean;
      issuedAt: string;
    };
```

`revision` is a positive safe integer that increases whenever the selected
release or enabled value changes, or an operator issues a new force command.
An enabled deployment must identify one signed release and an explicit `force`
value. A disabled deployment must not contain release, manifest, or force
fields.

`force: false` installs and stages a new release for the next feature open.
`force: true` requests reload of an already mounted view only after the release
has downloaded, verified, and installed successfully. It never bypasses
signature, compatibility, archive, health, failed-ID, or rollback rules. A
device with no mounted view simply uses the installed release on its next open.

The Worker returns a signed disabled payload with HTTP `200`. A `204`
response is not a deployment instruction because it cannot authenticate
`enabled: false` or carry a revision.

### Release payload

```ts
type ReleasePayloadV1 = {
  type: 'lynx-release';
  feature: string;
  releaseId: string;
  version: string;
  platform: 'ios' | 'android';
  compatibility: {
    runtimeVersion: string;
    minHostVersion: string;
    lynxEngineVersion: string;
  };
  archive: {
    format: 'zip';
    url: string;
    sha256: string;
    bytes: number;
    uncompressedBytes: number;
    entryCount: number;
  };
  files: Array<{
    path: string;
    bytes: number;
    sha256: string;
  }>;
};
```

`main.lynx.bundle` is required exactly once. Archives declare files only:
`entryCount` equals `files.length`, and `uncompressedBytes` equals the sum
of file bytes.

Unknown fields fail closed. The enabled and disabled deployment variants reject
fields belonging only to the other variant. Because `lynx-channel` was never
released, its fixtures and parser are replaced rather than retained as a
compatibility path.

Identifiers use:

```text
feature:   ^[a-z][a-z0-9-]{0,63}$
releaseId: ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$
sha256:    ^[a-f0-9]{64}$
```

Artifact URLs may be HTTPS or a safe relative URL. Tests and internal local
delivery may use HTTP. Relative URLs resolve only against the already verified
deployment or manifest endpoint and cannot contain traversal, a query, or a
fragment.

Signed `type` and `feature` provide domain separation. A valid release cannot
substitute for a deployment, a disabled deployment cannot select an artifact,
and a payload for one feature cannot select another feature's URL, cache, or
state.

Hard ceilings:

```text
max archive bytes:            64 MiB
max uncompressed bytes:      256 MiB
max single entry bytes:       64 MiB
max entries:                    4096
max compression ratio:          100
max UTF-8 path bytes:            512
max path depth:                   16
```

Host applications may lower these limits but cannot exceed them without a
native release.

## Requirements

- Parse envelopes and payloads into typed results/errors; never use unchecked
  casts at a trust boundary.
- Verify signature, expected `type`, and expected `feature` before using
  payload URLs, release IDs, revision, or enabled state.
- Require a positive safe deployment revision and UTC ISO-8601 `issuedAt`.
- Require enabled deployments to contain the exact release fields plus
  `force`, and disabled deployments to contain none of them.
- Validate safe feature and release identifiers, hashes, sizes, and URLs.
- Reject duplicate normalized file paths, absolute paths, backslashes, empty
  components, `.`, and `..`.
- Require archive counts and sizes to agree with the exact file contract.
- Include valid and invalid fixtures without production private keys or
  credentials.

## Acceptance criteria

- [ ] Valid enabled deployment, disabled deployment, and release fixtures parse
      deterministically in TypeScript and Swift.
- [ ] Unknown schema version, algorithm, document type, field, or archive format
      fails closed.
- [ ] Requested-feature mismatch fails after signature verification and before
      payload state or URLs are used.
- [ ] Disabled deployment carrying release fields fails.
- [ ] Disabled deployment carrying `force` fails.
- [ ] Enabled deployment missing any release field or `force` fails.
- [ ] Invalid revision, timestamp, URL, hash, size, ratio, or entry count fails.
- [ ] Duplicate, traversal, absolute, backslash, and oversized paths fail.
- [ ] Missing or multiple `main.lynx.bundle` entries fail.
- [ ] Base64url decoding rejects padding and invalid alphabet.
- [ ] Former `lynx-channel` fixtures are rejected; no compatibility parser is
      shipped.
- [ ] Fixtures require no TypeScript runtime and remain portable to Swift,
      Worker, and future Android tests.

## Required verification

```bash
pnpm --filter expo-lynx exec jest --runInBand --no-watchman
pnpm --filter expo-lynx lint
pnpm --filter expo-lynx build
git diff --check
```

## Out of scope

- Producer signing and deterministic ZIP creation.
- Native trust-root embedding and signature implementation.
- Network requests, persistence, download, extraction, or activation.
- Channels, separate activation modes, rollout cohorts, or expiry policy.
- Key rotation and multiple simultaneous trust roots.
