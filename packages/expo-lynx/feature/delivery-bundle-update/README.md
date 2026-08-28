# Lynx bundle updates

Production delivery for a Lynx view embedded in Expo/React Native.

## What it does

1. Every app ships a working `static.lynx` baseline.
2. At app launch, the native module renders the confirmed cached bundle, or the embedded baseline.
3. It checks a signed Cloudflare channel pointer once.
4. A new release downloads from R2 into staging with all declared assets.
5. Native code verifies signatures, compatibility, file sizes, and SHA-256.
6. The release activates now (`on-launch`) or on the next launch (`next-open`).
7. A failed candidate rolls back to the previous last-known-good bundle.

No background timer. No mid-session swap. No arbitrary production URL from React Native.

## Read these files

| File | Read when |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Understand the complete runtime and Cloudflare flow |
| [TESTING.md](./TESTING.md) | Verify implementation and production failure cases |
| [ROADMAP.md](./ROADMAP.md) | See deliberately deferred work |
| [`specs/`](./specs/) | Implementing or reviewing one ticket |

You normally need only this README and `ARCHITECTURE.md`.

## Work order

Client work lands in `release/bundle-update`, never directly in `main`.

| Order | Spec | Result |
|---:|---|---|
| 1 | [Lynx source contract](./specs/client/pr-01-lynx-source.md) | `embedded`, `managed`, `development` sources |
| 2 | [Release source guard](./specs/client/pr-02-release-source-guard.md) | Release rejects arbitrary URLs |
| 3 | [Manifest verification](./specs/client/pr-03-manifest-sha256.md) | Bad bytes never reach Lynx |
| 4 | [Embedded baseline](./specs/client/pr-04-embedded-baseline.md) | Offline-first launch |
| 5 | [Bundle store](./specs/client/pr-05-bundle-store-staging.md) | Staging and atomic promote |
| 6 | [Signed channel fetch](./specs/client/pr-06-channel-fetch-signed.md) | Cloudflare update discovery |
| 7 | [LKG fallback](./specs/client/pr-07-lkg-fallback.md) | Broken release rolls back |
| 8 | [Telemetry](./specs/client/pr-08-telemetry-errors.md) | Structured non-PII events |
| 9 | [Activation modes](./specs/client/pr-09-safe-activation.md) | `on-launch` and `next-open` |
| 10 | [Release logs](./specs/client/pr-10-release-log-hardening.md) | Error/Fatal only |
| 11 | [DevTool split](./specs/client/pr-11-devtool-pod-split.md) | Debug tools absent from Release |
| 12 | [Android parity](./specs/client/pr-12-android-parity.md) | Same behavior on Android |
| 13 | [Hot Updater primitives](./specs/client/pr-13-port-hotupdater-primitives.md) | Reuse small MIT crypto/state patterns |

Server contracts are mirrored under [`specs/server/`](./specs/server/) but land in a separate update-service repository.

## PR contract

The first non-blank line of every PR body must be:

```text
Spec: feature/delivery-bundle-update/specs/client/pr-XX-name.md
```

The AI reviewer reads that exact file and checks every acceptance criterion.

## Hard rules

- React Native chooses feature/channel, not executable production URLs.
- Native code owns trust, storage, activation, and rollback.
- R2 artifacts are immutable and content-addressed.
- A force update changes activation timing only; it never bypasses verification or fallback.
- Keep durable workflow state in React Native or the backend, not inside replaceable Lynx UI.
