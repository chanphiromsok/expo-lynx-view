# Testing

## Fast checks

```bash
cd /Users/phirom/Desktop/expo-lynx
pnpm run test
pnpm run lint
pnpm run build
```

These prove the TypeScript surface and utilities compile. They do **not** prove native delivery, security, activation, or rollback.

## Native build checks

```bash
cd /Users/phirom/Desktop/expo-lynx/example
pnpm expo prebuild --clean

# iOS
cd ios
pod install
xcodebuild -list
# Run the generated app workspace/scheme in Debug and Release.

# Android
cd ../android
./gradlew test assembleDebug assembleRelease
```

## Required production matrix

Record platform, app build, Lynx SDK, runtime version, channel revision, and release ID for every run.

| Scenario | Expected result |
|---|---|
| First install offline | Embedded baseline renders |
| Confirmed cache offline | Cached active bundle renders |
| Same release / HTTP 304 | No download or reload |
| New release, `next-open` | Current UI remains; candidate activates next launch |
| New release, `on-launch` | Candidate activates after verification this launch |
| Console force | Same as verified `on-launch`; no safety bypass |
| Invalid channel signature | Reject before manifest fetch |
| Replayed channel revision | Reject and retain current release |
| Invalid manifest signature/hash | Reject before activation |
| Incompatible runtime version | Reject before file download |
| Missing or bad sidecar | Delete staging; retain current UI |
| Network interrupted during download | No partial release appears in `ready/` |
| Two update checks race | One transaction wins; no duplicate/partial release |
| Candidate render error | Previous LKG renders |
| Candidate render timeout | Previous LKG renders |
| Process killed before confirmation | Next launch recovers previous LKG |
| Failed release returned again | Client skips it; no boot loop |
| Server rollback | Older target activates from newer channel revision |
| Cached rollback target | No redundant file download |
| Kill switch (`keep-current`) | Current release remains active |
| Release logs | No routine Lynx Debug/Info output |
| Resource traversal path (`../`) | Manifest rejected |
| Telemetry with token/query data | Sensitive content absent |

## Completion gates

- Run the full matrix on iOS before calling iOS complete.
- Run the same matrix on Android before merging Android parity.
- Do not combine an unverified platform with a verified platform in one completion claim.
- Unit tests must include signed fixture vectors shared by TypeScript, Swift, Kotlin, and Worker.
- A successful HTTP response is not success: read back R2/D1 state after publish, promote, force, and rollback.

## Current status

The existing Jest tests cover provisional TypeScript contracts only. Native bundle storage, signature verification, Cloudflare delivery, activation, and rollback remain unverified until their platform tests and the matrix above pass.
