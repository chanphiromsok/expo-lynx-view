# C02 — Generate the native runtime fingerprint

**Status:** planned; required before a public mobile release

**Spec:** `feature/delivery-bundle-update/specs/v2/cli/c02-native-runtime-fingerprint.md`

## Goal

Replace the static `expo-57` runtime label with one deterministic native
compatibility fingerprint produced by Expo's existing `@expo/fingerprint`
implementation.

The fingerprint uses the protocol's existing `runtimeVersion` field. It is not
an archive checksum, signature, release ID, or new database field.
It is calculated by build tooling and is never calculated on a user device or
on the Lynx first-render path.

## Depends on

- [C01 — CLI build and upload](c01-release-build-upload.md).
- The Expo app and its native/config-plugin inputs being installed locally.

## Owned files

- `packages/lynx-bundle-cli/`
- `scripts/lynx.mjs`
- the example Expo configuration and focused CLI tests

## Contract

### Native build

When building an embedded baseline, the CLI calculates the Expo project hash
and writes it as:

```json
{
  "schemaVersion": 1,
  "runtimeVersion": "<expo-project-hash>",
  "features": {}
}
```

The Expo plugin continues validating that registry and embeds the exact value
as `ExpoLynxRuntimeVersion`. Expo Lynx reads that key as its runtime authority;
it must not silently switch to a different `EXUpdatesRuntimeVersion` value.

Pin one compatible `@expo/fingerprint` version in the CLI so native builds and
release tooling do not resolve different algorithms.

### Remote release

`release` and `pack` read `runtimeVersion` from the last generated embedded
registry. They do not recalculate it from a possibly changed working tree and
do not accept the old repository-wide `expo-57` constant.

This makes a release target the native build represented by the checked-in or
otherwise retained embedded registry:

```text
native inputs -> Expo fingerprint -> embedded registry
                                      -> Info.plist
                                      -> release.json
                                      -> bundles.runtime_version
```

The existing `inputFingerprint` remains a stale-source check for each Lynx
feature. It must not be used as the native runtime fingerprint because normal
Lynx JavaScript changes must remain OTA-capable.

### Failure behavior

Release creation fails before build or upload when the registry is missing,
malformed, or has no valid `runtimeVersion`. The error tells the developer to
build the embedded baseline for the intended native build first.

Fingerprint calculation failures must not fall back to `expo-57`, app version,
the current date, or a random value.

## Acceptance criteria

- [ ] Embedded builds use `@expo/fingerprint`; no custom native hashing logic is
      introduced.
- [ ] The static `expo-57` runtime constant is removed from the normal build and
      release flow.
- [ ] The plugin, embedded registry, `release.json`, Worker bundle row, and
      mobile runtime use the exact same value.
- [ ] A Lynx-only source change does not change the runtime fingerprint.
- [ ] A native dependency, Expo config-plugin native input, Lynx native module,
      Pod/Gradle input, or native project change changes the fingerprint.
- [ ] Repeating the calculation with identical inputs returns the same value.
- [ ] A remote release reads the retained embedded runtime rather than silently
      targeting unbuilt native changes in the current working tree.
- [ ] Missing or stale runtime metadata stops before any network request.

## Required verification

```bash
pnpm --filter @expo-lynx/bundle-cli lint
pnpm --filter @expo-lynx/bundle-cli test
git diff --check
```

The test may use fixture projects or injected fingerprint output. It must not
run Expo prebuild, CocoaPods, Gradle, Xcode, a simulator, or a native build.

## Out of scope

- A custom fingerprint algorithm, fingerprint service, second compatibility
  column, EAS Update integration, automatic native builds, and per-feature
  native fingerprints.
