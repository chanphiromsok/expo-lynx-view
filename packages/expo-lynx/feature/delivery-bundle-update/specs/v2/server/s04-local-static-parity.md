# S04 — Local signed static-server parity and physical-device workflow

**Spec:** `feature/delivery-bundle-update/specs/v2/server/s04-local-static-parity.md`

## Goal

Upgrade the local rebuild/server workflow so a physical iPhone internal Release
build exercises the same signed ZIP, routes, ETag/cache, and failure contract as
the Cloudflare service. Android device validation remains in the roadmap.

## Depends on

- [M01 — Shared release protocol](../mobile/m01-shared-release-protocol.md).
- [S01 — Build, package, and signing CLI](s01-build-package-sign.md).

Read the S03 route/cache contract for parity, but S03 implementation is not a
dependency. This local server must unblock iOS-first work before Cloudflare/D1
is complete.

## Owned files

- current `rebuild-lynx-remote.mjs` / `serve-local-lynx-release.mjs` migration
- local static-server tests and fault-injection controls
- local/physical-device development documentation
- internal Release build flag/configuration evidence

## Requirements

- Invoke S01 build/package/sign code; do not create a second archive or signing
  format.
- Serve static equivalents of the documented channel, manifest, and artifact
  routes with
  exact envelope/archive bytes, content types, ETags, `304`, and immutable cache
  headers.
- Rebuilding a selected configured feature creates a new explicit release ID
  and channel revision; query-string cache busting is not identity.
- Print usable LAN URLs and iOS Simulator aliases.
- Support one command that rebuilds, packages, signs, promotes locally, and
  serves any configured feature.
- Use a committed test public key plus ignored locally generated private key;
  never commit the private half or read Cloudflare production secrets.
- Bind to a selected interface and warn when exposing beyond loopback.

Fault modes must include delayed/chunked download, interrupted response,
corrupt archive, hash mismatch, invalid signature, `404`, server error, and
unchanged `304`.

The parity route shape is:

```text
GET /v1/channels/:feature/:channel
GET /v1/releases/:feature/:releaseId/manifest
GET /v1/releases/:feature/:releaseId/release.zip
```

The local implementation may additionally expose short compatibility aliases
such as `/manifest.json` and `/release.zip`, but those aliases are not used by
the managed Worker/mobile contract and must not be presented as production API.

## Local security boundary

- Cleartext/LAN execution and the development key are allowed only in explicit
  internal configuration such as `LYNX_ALLOW_LOCAL_MANAGED_RELEASE`.
- Distributable production configuration rejects the test fingerprint,
  cleartext local hosts, and arbitrary executable URLs.
- Local allowance changes only transport/trust fixture selection; archive,
  signature, compatibility, installation, activation, and rollback checks stay
  enabled.

## Physical-device workflow

1. Put the device and development computer on a mutually reachable network.
2. Start the command and use its LAN IP, never phone `localhost`.
3. Open the printed URL in mobile Safari/Chrome before debugging native code.
4. Build/install the internal Release host with local managed delivery enabled.
5. Open embedded/current content, rebuild/promote, run a channel update check,
   and verify the intended M04 lifecycle boundary: unchanged content does not
   download; a new release downloads and becomes active at the documented
   boundary.
6. Verify cached offline open plus corrupt/interrupted fallback.

Document firewall, VPN, captive/client-isolation, changed-IP, and simulator
alias pitfalls.

## Acceptance criteria

- [ ] One command serves any configured mini-app with M01/S01-compatible bytes
      and the documented S03 route shape.
- [ ] Physical iPhone internal Release can consume the generated signed ZIP.
- [ ] Unchanged channel returns `304`; rebuild creates a new revision/ETag.
- [ ] Every fault mode reaches a stable callback and retains LKG/embedded UI.
- [ ] Production/distributable mode rejects local HTTP and the test key.
- [ ] Rebuilding a remote mini-app requires no Expo prebuild; native config,
      public key, embedded baseline, or feature changes still require host build.

## Required verification

- Run S01 packager/signer and local HTTP tests.
- Assert route bytes/headers against the documented S03 contract fixtures.
- Complete the workflow on a physical iPhone; Android validation is retained in
  roadmap M05/M08 and is not a current gate.
- Record exact command, feature, LAN URL shape, host configuration, release ID,
  revision, and callbacks.

## Out of scope

- Cloudflare deployment or local D1 requirement.
- Arbitrary production cleartext access.
- Expo Updates publication of the host bundle.
