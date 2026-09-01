# M01 — Mobile signed deployment and ZIP installation

**Spec:** `feature/delivery-bundle-update/specs/v2/mobile/m01-shared-release-protocol.md`

## Goal

Make the iOS managed Lynx source fetch one public deployment document, verify
that document with one public key embedded in the native app, download one ZIP,
verify its SHA-256, install it safely, and preserve the last known good source
through every failure.

There is no channel lookup, release manifest lookup, base64 payload envelope,
per-file signed manifest, or mobile authentication token.

## Depends on

- [C01 — CLI build and upload](../cli/c01-release-build-upload.md).
- [W01 — Worker storage and delivery](../worker/w01-delivery-worker.md).

## Owned files

- `packages/expo-lynx/src/ReleaseProtocol.ts`
- `packages/expo-lynx/src/ExpoLynx.types.ts`
- `packages/expo-lynx/src/ExpoLynxModule.ts`
- `packages/expo-lynx/src/LynxSource.ts`
- `packages/expo-lynx/app.plugin.js`
- the iOS signature verifier, managed delivery coordinator, bundle store, and
  focused TypeScript/Swift fixtures and tests

Android must later consume the same response contract, but Android
implementation is out of scope.

## Build-time configuration

The Expo plugin accepts one Worker endpoint per managed feature and one public
key path:

```json
{
  "embeddedBundlesPath": "./generated/expo-lynx/embedded",
  "publicKeyPath": "./keys/lynx/delivery.public.pem",
  "deliveryEndpoints": {
    "delivery": "https://delivery.example.com/v1/deploy/delivery"
  }
}
```

The app embeds only the public key. It must reject private-key PEM blocks,
inline keys, response-supplied keys, and runtime key discovery. JavaScript may
select only a configured feature; it cannot provide an endpoint, key, release
ID, ZIP URL, enabled value, or force value.

## Response verification

For a `200` response:

1. Read the body as bounded raw bytes without parsing it.
2. Require one `lynx-signature` header using unpadded base64url.
3. Verify RSASSA-PKCS1-v1_5/SHA-256 over the exact raw body bytes with the
   embedded public key.
4. Only after successful verification, decode UTF-8 and parse strict JSON.
5. Require `schemaVersion: 1`, `type: "lynx-deployment"`, and the requested
   feature.
6. Validate the exact enabled or disabled shape from the v2 index.

Missing/invalid signatures, invalid UTF-8/JSON, duplicate JSON keys, unknown
fields, wrong feature/type/version, unsafe values, or a response body above 16
KiB fail without changing local release state.

Production requires HTTPS. Debug/internal builds may use an explicitly enabled
HTTP LAN endpoint with the same signature and archive checks.

## Enabled deployment validation

- `revision` is a positive safe integer.
- `issuedAt` is a valid UTC ISO-8601 timestamp used for diagnostics, not local
  clock authorization.
- `releaseId` and `feature` use bounded safe identifiers.
- `runtimeVersion` must exactly equal the native host's configured runtime.
- `archiveUrl` is HTTPS or a safe same-origin relative URL. Internal builds may
  allow same-origin HTTP. Traversal, credentials, fragments, and unsupported
  schemes fail.
- `archiveSha256` is exactly 64 lowercase hexadecimal characters.
- `archiveBytes` is a positive safe integer no larger than 64 MiB.
- A lower revision is rejected. The same revision is a no-op. A higher revision
  is considered once, including when it selects an older release as rollback.

## Download and installation

After accepting a new enabled deployment whose release is not already
installed:

```text
download release.zip to a transaction file
  -> enforce Content-Length when present and a 64 MiB streaming limit
  -> require actual byte length = archiveBytes
  -> require SHA-256 = archiveSha256
  -> inspect ZIP entries before extraction
  -> extract into an app-private sibling transaction directory
  -> require exactly one main.lynx.bundle
  -> atomically rename the complete directory into ready/<releaseId>
```

The ZIP hash covers every byte in the archive, so the wire protocol does not
carry a second file list. Native installation still rejects:

- absolute, traversal, backslash, NUL, empty, dot, or escaping paths;
- duplicate/case-colliding paths;
- symlinks, hard links, devices, encryption, and unsupported ZIP features;
- more than 4096 entries, path depth above 16, or UTF-8 path length above 512;
- expanded bytes above 256 MiB, a single entry above 64 MiB, or compression
  ratio above 100; and
- missing or multiple `main.lynx.bundle` entries.

Hashing, download, ZIP inspection, and extraction stay off the UI and React
Native JavaScript threads. A failed transaction leaves no ready directory and
does not change active/pending pointers.

## Enabled, disabled, and force behavior

`enabled: false` means the Worker is offering no new release. After verifying a
new disabled revision, mobile records that revision but:

- does not download anything;
- does not delete verified files;
- does not clear active, pending, previous, or attempting release IDs;
- does not reload a mounted view; and
- continues opening the current verified remote release, or the exact embedded
  feature baseline when no remote release exists.

For an enabled deployment:

- `force: false` installs or reuses the selected release and marks it pending.
  Mounted UI is unchanged. The pending release is attempted on the next feature
  open and becomes active only after the existing Lynx health boundary passes.
- `force: true` first installs or reuses the selected release. If a matching
  view is mounted, it reloads only after verification and installation finish.
  With no mounted matching view, it becomes pending for the next open.
- A force revision is consumed at most once. A later revision may intentionally
  request force reload of the same release again.

Network, HTTP, signature, revision, compatibility, checksum, ZIP, disk,
installation, reload, timeout, or process-death failure preserves the current
view and restores the previous verified release or embedded baseline.

## Acceptance criteria

- [ ] Exact Worker fixture bytes verify in TypeScript and Swift; any changed
      body byte or signature byte fails.
- [ ] The body is not parsed and no URL/state field is used before signature
      verification.
- [ ] Missing signature, unsigned body, wrong feature/type/runtime, unknown
      field, invalid revision, unsafe URL, invalid hash, or oversize body fails
      without local state mutation.
- [ ] A valid new ZIP is downloaded once, length/hash checked, safely installed,
      and reopened through the cheap completed-directory path.
- [ ] The malicious ZIP corpus fails without path escape or partial ready state.
- [ ] Disabled preserves active and pending remote releases across reopen.
- [ ] `force: false` stages for next open and never changes a mounted view.
- [ ] `force: true` reloads a mounted view only after verified installation and
      falls back safely on failure.
- [ ] Offline and every failed check continue using last-known-good or embedded.
- [ ] No control token, private key, arbitrary endpoint, or response-supplied
      public key is reachable from the mobile API.

## Required verification

```bash
pnpm --filter expo-lynx exec jest --runInBand --no-watchman
node --test packages/expo-lynx/app.plugin.test.js
swiftc -parse <each-touched-standalone-swift-file>
git diff --check
```

Do not start Xcode, an iOS simulator, CocoaPods, or a native iOS build without
explicit user approval. Physical-device validation is a later manual gate for
enabled/disabled, force false/true, corrupt ZIP, offline, and rollback cases.

## Out of scope

- Android implementation, server push, background fetch, percentage rollout,
  channels, deltas, encrypted bundles, remote key rotation, and deleting a
  device's installed release when delivery is disabled.
