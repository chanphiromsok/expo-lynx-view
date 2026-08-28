# PR13 — Port hot-updater primitives (Reuse)

**Spec:** feature/delivery-bundle-update/specs/client/pr-13-port-hotupdater-primitives.md

## Goal

Port the small MIT-licensed primitives from `@hot-updater/react-native` so
we don't reinvent SHA-256 helpers, Ed25519 verification, the
UserDefaults wrapper, and the bundle-store path management. We do NOT
adopt their plugin system, their JS API, their CLI, their console, or
their HotUpdaterImpl — those are over-built for our single-customer,
single-storage, single-database setup.

## Files to port verbatim

| Source (hot-updater MIT) | Destination (expo-lynx) | PR |
|--------------------------|--------------------------|-----|
| `ios/HotUpdater/Internal/HashUtils.swift` (63 lines) | `ios/LynxHash.swift` | PR3 |
| `ios/HotUpdater/Internal/VersionedPreferencesService.swift` (82 lines) | `ios/LynxChannelState.swift` | PR5 |

## Files to port after trimming

| Source | Destination | Trim what |
|--------|-------------|-----------|
| `ios/HotUpdater/Internal/SignatureVerifier.swift` (371 lines) | `ios/LynxSignature.swift` | Drop RSA, drop curve variants. Keep Ed25519 only. ~120 lines. |

## Files to write from scratch (concept-only)

| Concept | Our file | PR |
|---------|----------|-----|
| `BundleFileStorageService.swift` (2664 lines) | `ios/LynxBundleStore.swift` (~200 lines) | Drop all archive formats (zip/tar/tar.gz/tar.br/streaming). We download individual files per manifest, not archives. |
| `HotUpdaterImpl.swift` (726 lines) | `ios/LynxBundleCoordinator.swift` (~150 lines) | Our activation modes are `on-launch` / `next-open`, not their default. Their flow assumes a different state model. |
| `HotUpdaterCrashHandler.mm` (4 lines, mostly bridge) | `ios/LynxCrashWatchdog.swift` (~50 lines Swift) | Same watchdog idea: detect that `notifyAppReady` didn't fire last launch → revert. Different implementation because we're not on RN's bridge. |

## License

hot-updater is MIT. The above ports retain the original MIT header +
copyright. New code (the from-scratch files) is MIT under this project.

## Acceptance criteria

- [ ] SHA-256 hash of a test string matches between hot-updater's `HashUtils` and our `LynxHash`
- [ ] Ed25519 verify of a known signature matches between hot-updater's `SignatureVerifier` and our `LynxSignature`
- [ ] `LynxChannelState` round-trips: write `last_manifest_id = "abc123"`, kill app, relaunch, read back `"abc123"` — same as VersionedPreferencesService would
- [ ] `LynxBundleStore` exposes only `stage/promote/currentReadyURL/pruneInactive` — no archive APIs leak in
- [ ] `LynxBundleCoordinator` exposes only the 2-mode switch — no plugin / no cohort / no notification APIs
- [ ] `LynxCrashWatchdog` correctly identifies a missed `notifyAppReady` and reverts

## Out of scope

- Adopting hot-updater as a CocoaPod (their pod is built for bare RN, not for Expo modules wrapping a non-RN engine)
- Their `wrap()` HOC, their `HotUpdater.checkForUpdate(...)` JS API (we have a different surface: `ExpoLynxView`)
- Their CLI / console / web dashboard (we ship a Cloudflare Worker, not a CLI)
- Their plugin system (we have one storage, one database, one API)
- Their `bsdiff` implementation (separate deferred issue; only relevant if/when we ship binary diffing)
