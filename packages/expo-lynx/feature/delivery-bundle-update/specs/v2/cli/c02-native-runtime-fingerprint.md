# C02 — Generate the native runtime fingerprint

**Status:** implemented

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

`host embed` builds one platform-neutral baseline and does not calculate a
native fingerprint. `host prepare` calculates and stores both Expo project
hashes; `--platform <platform>` limits it to one platform:

```json
{
  "schemaVersion": 2,
  "features": {
    "mart": { "baseline": "mart/baseline.json" }
  },
  "runtimes": {
    "ios": {
      "runtimeVersion": "ios:<expo-project-hash>",
      "appVersion": "1.0.0",
      "buildNumber": "30"
    }
  }
}
```

The Expo plugin selects the current native platform's prepared record and
embeds its exact value as `ExpoLynxRuntimeVersion` on iOS or the Android
delivery configuration runtime. Expo Lynx reads that value as its runtime
authority.

Pin one compatible `@expo/fingerprint` version in the CLI so native builds and
release tooling do not resolve different algorithms.

### Remote release

Independent mini-app `release` and `pack` commands do not read, calculate, or
upload a native runtime. One verified release can be selected independently
for compatible iOS and Android deployment scopes:

```text
native inputs -> Expo fingerprint -> registry.runtimes[platform]
                                      -> native configuration
                                      -> host register
                                      -> deployments.runtime_version

mini-app source -> release.zip -> verified bundle
                                  -> selected by a compatible deployment
```

### Failure behavior

Host preparation fails when the shared embedded registry is missing or
malformed. Native prebuild and host registration fail when the selected
platform has no prepared runtime. Mini-app release creation remains independent
from host runtime state.

Fingerprint calculation failures must not fall back to `expo-57`, app version,
the current date, or a random value.

## Acceptance criteria

- [x] Host preparation uses `@expo/fingerprint`; no custom native hashing logic is
      introduced.
- [x] The static `expo-57` runtime constant is removed from the normal build and
      release flow.
- [x] The plugin, embedded registry, Worker deployment, and mobile runtime use
      the exact same platform runtime value; releases remain platform-neutral.
- [x] A Lynx-only source change does not change the runtime fingerprint.
- [x] A native dependency, Expo config-plugin native input, Lynx native module,
      Pod/Gradle input, or native project change changes the fingerprint.
- [x] Repeating the calculation with identical inputs returns the same value.
- [x] Host registration verifies the retained prepared runtime against the
      current working tree before making a network request.
- [x] Missing or stale runtime metadata stops before any network request.

## Required verification

```bash
pnpm --filter expo-lynx-bundle-cli lint
pnpm --filter expo-lynx-bundle-cli test
git diff --check
```

The test may use fixture projects or injected fingerprint output. It must not
run Expo prebuild, CocoaPods, Gradle, Xcode, a simulator, or a native build.

## Out of scope

- A custom fingerprint algorithm, fingerprint service, second compatibility
  column, EAS Update integration, automatic native builds, and per-feature
  native fingerprints.
