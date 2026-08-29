# M05 — Android managed delivery, hardened ZIP installation, and lifecycle parity

Status: **ROADMAP — DO NOT ASSIGN IN THE CURRENT iOS/SERVER MILESTONE**.

**Spec:** `feature/delivery-bundle-update/specs/v2/mobile/m05-android-delivery-installation.md`

## Goal

Implement Android feature/source/state/event parity and the complete signed ZIP
installer in one platform slice, matching the M03/M04 safety and lifecycle
semantics before any engine-reuse optimization.

## Why these tasks are merged

Android managed-source scaffolding existed only to support installation and
activation. Combining them prevents a temporary unsigned/unpacked path from
becoming a second production implementation and gives the developer one clear
parity target.

## Depends on

- [A01 — Android Expo resources/trust foundation](../roadmap/android/a01-android-foundation.md).
- [M01 — Shared protocol](m01-shared-release-protocol.md).
- [M02 — Native embedded resources and signature verifier](m02-trust-roots-signature-verification.md).
- [M03 — Hardened install semantics](m03-ios-archive-installation.md).
- [M04 — Public API and lifecycle semantics](m04-prefetch-activation-recovery.md).
- [S04 — Local signed fixture server](../server/s04-local-static-parity.md).

## Owned files

- Android `ExpoLynxModule.kt` / `ExpoLynxView.kt`
- Android coordinator, state, store, ZIP inspector/extractor, and downloader
- Android source/event parity fixes in shared TypeScript only when necessary
- Android unit/instrumentation/security/lifecycle tests and example evidence

## Source and embedded parity

- Parse the same `embedded`, `managed`, and internal-only `development` source
  contract as iOS.
- Resolve exact features from `assets/expo-lynx/embedded/registry.json`; reject
  unknown/missing entries and never use generic `static.lynx`.
- Embedded bytes stay in APK assets, never copied into writable cache or fully
  rehashed per open.
- Validate feature/channel/activation/runtime/host fields using M01.
- Release rejects arbitrary unsigned HTTP/raw executable URLs; local HTTP is
  only the explicit S04 internal configuration.

## State, API, and threading parity

- Persist active, previous LKG, pending, attempting, failed IDs, last revision,
  and ETag in app-internal storage.
- Match M04 prefetch return values, progress/error phases, `onLoadStart`,
  `onLoad`, `onError`, terminal behavior, deduplication, and stale-generation
  rejection.
- Render cached/embedded content before network response.
- Network/disk/hash/ZIP work stays off Android UI and RN JS threads; View/Lynx
  mutations run on Android UI thread.
- `next-open` is default; current-open behavior must keep active UI visible until
  candidate health succeeds or remain disabled with documented parity gap.

## Android install transaction

```text
verify release signature/type/feature/compatibility
  -> download to app-internal transaction staging
  -> verify archive length/SHA-256 and disk budget
  -> inspect central directory with ZipFile
  -> stream extraction with ZipInputStream/equivalent
  -> verify exact entries, CRC, sizes, and file SHA-256 once
  -> write completion metadata
  -> atomic rename to ready/<releaseId>
  -> only then allow pending/attempting state
```

- Apply every M01 path/type/count/size/ratio limit and the shared M03 malicious
  fixture corpus.
- Reject traversal, absolute/backslash paths, collisions, links/devices,
  encryption, unsupported ZIP64/compression, unexpected/missing entries, CRC,
  truncation, corruption, and expansion mismatch.
- Stage/final share app-internal filesystem. If rename cannot be guaranteed, use
  a second temporary directory plus completion marker; never point at partial
  copied data.
- Deduplicate by feature + release; clean stale transactions after process
  death.
- Cached open uses completion/identity/compatibility/entry checks without full
  rehash or network.

## Failure behavior

- Any signature/download/disk/ZIP/file/promotion/load failure preserves active
  or exact-feature embedded UI.
- Interrupted work cannot create a complete marker or pointer.
- Low disk fails before destructive work.
- Failed candidate recovery and immutable-ID blocking match M04.
- All failure/progress payloads match iOS fields and stable codes.

## Acceptance criteria

- [ ] Same TypeScript source/prefetch API works on iOS and Android.
- [ ] Android internal Release opens embedded/cached content before failed
      network and rejects arbitrary raw HTTP.
- [ ] Valid signed ZIP installs and loads from app-internal storage.
- [ ] Second open performs no archive download/full file scan.
- [ ] Every M03 malicious fixture fails equivalently.
- [ ] Kill during download/extract/promotion/candidate attempt exposes no partial
      ready release and recovers LKG/embedded.
- [ ] Duplicate prefetch performs one transaction and source/unmount races are
      safe.
- [ ] Progress, terminal callbacks, activation, rollback, and safe-area layout
      match documented iOS behavior or an explicit current-open limitation is
      recorded without weakening next-open correctness.

## Required verification

```bash
pnpm run test
pnpm run lint
pnpm run build
cd apps/expo-lynx-example/android
./gradlew test assembleDebug assembleRelease
```

Run Android internal Release embedded, cached, signed install, corrupt,
interrupted, low-disk, duplicate prefetch, next-open, process-death, rapid-source
change, and offline cases. Record app-internal paths and iOS/Android parity
differences.

## Out of scope

- Lynx engine reuse (M06).
- Cache quota/LRU hardening beyond transaction cleanup (M07).
- Deltas and production Cloudflare deployment.
