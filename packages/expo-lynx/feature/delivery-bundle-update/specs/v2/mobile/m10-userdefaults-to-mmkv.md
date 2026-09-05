# M10 — Native delivery state: UserDefaults to MMKV

**Status:** implemented reference

**Spec:** `feature/delivery-bundle-update/specs/v2/mobile/m10-userdefaults-to-mmkv.md`

## Goal

Move the small, synchronous iOS delivery-state snapshot from `UserDefaults` to
one native MMKV store. Preserve the exact activation, rollback, ETag, and
revision behavior while making the launch read a bounded local key-value read.

This is native storage only. It does not expose MMKV to JavaScript, add an RN
bridge, store bundle bytes, or replace the installed-release filesystem cache.

## Depends on

- [M04 — Update check, activation, and recovery](m04-update-check-activation-recovery.md).
- [M09 — Runtime-safe IFR launch](m09-runtime-bound-cache.md).

## Owned files

- `packages/expo-lynx/ios/ExpoLynx.podspec`
- `packages/expo-lynx/ios/Delivery/LynxManagedDeploymentState.swift`
- `packages/expo-lynx/ios/tests/LynxManagedDeploymentStateFixtureTest.swift`

## Storage contract

The `ExpoLynx` pod depends on MMKV. The store is private to this module:

```text
MMKV ID:    expo.lynx.managed.v3
MMKV root:  Application Support/ExpoLynx/MMKV
state key:  expo.lynx.managed.v3.<SHA-256(runtimeVersion)>.<feature>
value:      one JSON-encoded LynxManagedState blob
```

The runtime hash keeps storage keys bounded and prevents a runtime value from
becoming a raw key or path segment. The feature remains the already validated
native feature identifier.

`LynxManagedState` is unchanged:

```swift
struct LynxManagedState: Codable, Sendable {
  var activeReleaseID: String?
  var previousReleaseID: String?
  var pendingReleaseID: String?
  var attemptingReleaseID: String?
  var failedReleaseIDs: [String]
  var lastETag: String?
  var lastRevision: Int?
}
```

One blob is deliberate: the fields must change together during staging,
candidate confirmation, rollback, and replay protection. Do not split them
into separate MMKV keys.

## One-time migration and fallback

For one scoped key, reads follow this order:

```text
MMKV state exists              -> decode and use it
otherwise UserDefaults exists  -> copy blob to MMKV; delete defaults only after copy succeeds
otherwise                      -> use empty state
```

A crash before the MMKV write leaves the UserDefaults blob available for the
next launch. A crash after the MMKV write may leave a harmless legacy copy;
MMKV wins on later reads. Never delete UserDefaults before MMKV confirms the
write.

If MMKV cannot open or write, retain `UserDefaults` as the compatibility
fallback. A corrupt or undecodable value resolves to empty state; it must not
crash the host app or cause an unchecked cached release to load.

## IFR and lifecycle rules

`prepareStorage()` runs once on the main actor while `ExpoLynxView` is created.
Managed source resolution then synchronously reads exactly one state blob before
selecting pending cache, active cache, or the embedded fallback.

```text
open MMKV once
  -> read one runtime + feature state blob
  -> choose local cached or embedded bundle
  -> Lynx loadTemplate
  -> first screen
  -> only then check the Worker
```

MMKV migration must not introduce a network request, actor hop, ZIP work,
directory scan, hash recomputation, or JavaScript round trip before
`loadTemplate`. The existing completion-marker runtime check remains required;
MMKV state is only a pointer, never proof that bundle bytes are compatible.

## Acceptance criteria

- [ ] State is stored under the dedicated MMKV ID and Application Support root.
- [ ] One encoded blob stores all delivery state for one runtime and feature.
- [ ] A legacy UserDefaults blob is copied before it is removed.
- [ ] MMKV failure preserves a UserDefaults fallback instead of losing state.
- [ ] A crash during migration cannot delete the only valid state copy.
- [ ] Existing pending, active, rollback, ETag, and revision semantics remain unchanged.
- [ ] A cache pointer still requires completion-marker runtime validation before use.
- [ ] Initial managed source selection remains synchronous, local-only, and before Worker work.
- [ ] Fixture coverage proves interrupted-attempt recovery and UserDefaults migration.
