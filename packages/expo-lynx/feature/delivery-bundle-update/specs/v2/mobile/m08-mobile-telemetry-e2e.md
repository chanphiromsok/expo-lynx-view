# M08 — Mobile telemetry and end-to-end Release gate

Status: **ROADMAP — DO NOT ASSIGN IN THE CURRENT iOS/SERVER MILESTONE**.

**Spec:** `feature/delivery-bundle-update/specs/v2/mobile/m08-mobile-telemetry-e2e.md`

## Goal

Finish the mobile system with stable non-PII telemetry and repeatable iOS and
Android internal Release evidence for the complete signed ZIP lifecycle.

## Depends on

- M01 through M07.
- [S03 public delivery](../server/s03-channel-api-operations.md) or
  [S04 local parity server](../server/s04-local-static-parity.md).

## Event contract

Events include feature, channel, release ID, channel revision, source, phase,
duration, bytes, stable error, and fallback flag. Exclude tokens, headers,
private paths, initial data, and bundle contents.

Minimum phases:

```text
channel-check
download
verify-archive
extract
verify-files
stage
load
confirm
rollback
evict
```

## Requirements

- Monotonic progress/duration and one terminal result per transaction.
- Correlate native update-check/download/install/load without secrets.
- Automate valid, corrupt signature/hash, traversal, duplicate, limit bomb,
  incompatible runtime, offline, timeout, process death, candidate failure,
  rollback, and cache eviction.
- Update `TESTING.md` with exact commands and evidence template.
- Test each platform independently; shared unit tests do not prove parity.

## Acceptance criteria

- [ ] Valid lifecycle emits ordered phases and one terminal success.
- [ ] Every failure emits stable code/fallback with no sensitive data.
- [ ] iOS and Android internal Release independently pass the production matrix.
- [ ] Cached/embedded opens prove no full rehash/network dependency.
- [ ] Splash/loading always terminates and safe-area/layout stays stable.
- [ ] Report records app build, OS, Lynx/runtime version, feature, release ID,
      revision, and engine-reuse state.

## Required verification

```bash
pnpm run test
pnpm run lint
pnpm run build
```

Also run both platform Release builds/full matrix. Attach redacted logs plus
screenshots/recordings for loading, candidate swap, and rollback.

## Out of scope

- Selecting a third-party analytics vendor or production rollout cohorts.
