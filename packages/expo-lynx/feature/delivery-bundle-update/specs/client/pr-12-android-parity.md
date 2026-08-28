# PR12 — Android parity

**Spec:** feature/delivery-bundle-update/specs/client/pr-12-android-parity.md

## Goal

All 11 client-side features work on Android.

## Files

- `android/src/main/java/.../ExpoLynxModule.kt (mirror of `ExpoLynxModule.swift`)`
- `android/src/main/java/.../ExpoLynxView.kt (mirror of `ExpoLynxView.swift`)`
- `android/src/main/java/.../LynxBundleStore.kt, `LynxChannelClient.kt`, `LynxEnvironment.kt`, `LynxManifest.kt`, `LynxTelemetry.kt``

## Contract

Mirror iOS contract exactly. Native types use Kotlin equivalents of Swift actor / Result / Data.

## Why

See [Architecture](../../ARCHITECTURE.md).

## Acceptance criteria

- [ ] Android emulator, run every failure scenario from ../../TESTING.md
- [ ] Same pass/fail as iOS

## Out of scope

- Android-specific performance tuning (separate concern)
