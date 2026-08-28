# PR5 — `LynxBundleStore` + staging + atomic promote

**Spec:** feature/delivery-bundle-update/specs/client/pr-05-bundle-store-staging.md

## Goal

Downloaded releases go to `staging/<uuid>`, verify, then rename into `ready/<releaseId>`. Ready directories are immutable.

## Files

- `ios/LynxBundleStore.swift` (new — single serial actor)
- `ios/LynxChannelState.swift` (new — `UserDefaults` wrapper, see ../../ARCHITECTURE.md#local-persistent-state)
- `ios/ExpoLynxModule.swift` (instantiate once in `OnCreate`)

## Contract

```swift
actor LynxBundleStore {
  func stage(url: URL) throws -> StagedBundle
  func promote(_ staged: StagedBundle) throws -> URL  // atomic rename
  func readyURL(for releaseId: String) -> URL?
  func pruneInactive(keeping: Set<String>) throws
}
```

## Why

See [Architecture](../../ARCHITECTURE.md).

## Acceptance criteria

- [ ] Kill the app mid-download → relaunch → no half-written file in `ready/`
- [ ] Two parallel downloads of the same release → only one writes `ready/<releaseId>`
- [ ] Pruning retains active, previous LKG, and pending releases

## Out of scope

- Channel fetch (PR6)
- LKG fallback (PR7)
