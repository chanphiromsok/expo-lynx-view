# Lynx bundle updates

Production delivery for a Lynx view embedded in Expo/React Native.

## What it does

1. Every declared feature ships a generated `main.lynx.bundle` + sidecar
   baseline in the signed native app.
2. On mini-app open, native renders the confirmed cached bundle, or the embedded baseline.
3. It checks a signed Cloudflare channel pointer once.
4. A new immutable ZIP release downloads from R2 into transaction staging.
5. Native verifies signatures, compatibility, archive limits, paths, sizes, and SHA-256 once during installation.
6. The release is staged and activates on the next mini-app open (`next-open`).
7. A failed candidate rolls back to the previous last-known-good bundle.

No background timer. No mid-session swap. No arbitrary production URL from React Native.

## Read these files

| File | Read when |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Understand the complete runtime and Cloudflare flow |
| [HOT-UPDATER-ARCHIVE-REVIEW.md](./HOT-UPDATER-ARCHIVE-REVIEW.md) | Review the pinned Hot Updater iOS/Android extraction architecture and Lynx hardening decisions |
| [TESTING.md](./TESTING.md) | Verify implementation and production failure cases |
| [ROADMAP.md](./ROADMAP.md) | See deliberately deferred work |
| [V2 implementation specs](./specs/v2/README.md) | Assign one current mobile or server task to an implementation agent |
| [V2 PR review checklist](./specs/v2/PR-REVIEW-CHECKLIST.md) | Review the code and verify the app after a PR is ready |

Start with this README and `ARCHITECTURE.md`; use `specs/v2` for implementation
work. The current local implementation is the Console Worker, not the retired
static-server prototype.

## Current implementation sequence

Use the [V2 work order](./specs/v2/README.md) for all new ZIP,
RSA-SHA256 signing, channel update checks, conditional download, caching,
activation, D1, R2, promotion, and
rollback work. The active milestone contains 6 iOS mobile specs and 5
producer/server specs. Android delivery and engine reuse remain preserved in
the [development roadmap](./specs/v2/DEVELOPMENT-ROADMAP.md) and are not active
implementation work yet.

After an implementation PR is ready, give its assigned spec and the
[V2 PR review checklist](./specs/v2/PR-REVIEW-CHECKLIST.md) to a separate review
agent. The review is not complete until the changed automated checks pass and
the applicable Release-build app/server checks have been run.

## PR contract

The first non-blank line of every PR body must be:

```text
Spec: feature/delivery-bundle-update/specs/v2/<mobile|server>/<file>.md
```

The AI reviewer reads that exact file and checks every acceptance criterion.

## Hard rules

- React Native chooses feature/channel, not executable production URLs.
- Native code owns trust, storage, activation, and rollback.
- The `lynx-bundle.config.ts` feature key is the source directory, embedded
  registry key, RN feature, native cache namespace, and server feature ID.
- Generated baselines live outside Expo normal assets and are copied once by the
  config plugin; remote ZIPs update existing declared features only.
- R2 artifacts are immutable, release-scoped, and hash-linked by signed metadata.
- A force update changes activation timing only; it never bypasses verification or fallback.
- Keep durable workflow state in React Native or the backend, not inside replaceable Lynx UI.
