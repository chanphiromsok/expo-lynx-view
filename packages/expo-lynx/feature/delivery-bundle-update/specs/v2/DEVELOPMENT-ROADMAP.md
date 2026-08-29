# Remote Lynx bundle development roadmap

This roadmap separates the current iOS + producer/server milestone from the
preserved Android/cross-platform work. Roadmap specs are design assets, not
active assignments.

## Milestone 1 — Current: iOS + producer/server

Only these specs may be assigned now:

```text
M01 shared protocol
  ↓
S01 build + embedded + package + sign
  ├─────────────────┐
  ↓                 ↓
M02 iOS resources   S04 local signed server
  └────────┬────────┘
           ↓
M03 iOS extract + install
           ↓
M04 RN prefetch + iOS activation/recovery

Server implementation in parallel:
S01 → S02 release storage/upload → S03 channel API/operations → S05 server E2E
```

### Milestone 1 completion

- Physical iPhone internal Release loads exact-feature embedded baseline.
- A signed local/Cloudflare ZIP installs atomically and opens from cache without
  a full rehash.
- RN prefetch, progress, `next-open`, optional candidate `on-launch`, force
  timing, rollback, process-death recovery, and terminal splash behavior pass.
- Producer CLI, D1/R2 publication, public routes, promotion, rollback, and
  server E2E gates pass.
- No Android/Kotlin/native Android implementation or Android build evidence is
  required for this milestone.

This is an iOS/server milestone, not cross-platform production completion.

## Milestone 2 — Roadmap: Android foundation and parity

Do not assign until Milestone 1 is accepted and Android work is explicitly
resumed.

1. [A01 — Android Expo resources and trust foundation](./roadmap/android/a01-android-foundation.md)
2. [M05 — Android delivery and installation](./mobile/m05-android-delivery-installation.md)
3. [M06 — Optional Android engine reuse](./mobile/m06-android-engine-reuse.md)
4. [M07 — Cross-platform cache/disk/recovery](./mobile/m07-cache-disk-recovery.md)
5. [M08 — Both-platform telemetry/E2E](./mobile/m08-mobile-telemetry-e2e.md)

### Resume gate

- Confirm installed Lynx Android SDK and `LynxViewGroup` API version.
- Select Android emulator/device and internal Release build configuration.
- Revalidate shared M01/S01 fixtures before editing Kotlin/native Android code.
- Update the active dependency graph in `README.md`; do not implement a roadmap
  file while it is still marked inactive.

## Deferred does not mean deleted

M05–M08 retain their full requirements, acceptance criteria, and verification
commands. They are intentionally excluded from the current work order so an
agent cannot interpret them as prerequisites for iOS/server delivery.
