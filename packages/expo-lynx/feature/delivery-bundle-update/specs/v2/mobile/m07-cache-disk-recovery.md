# M07 — Cross-platform cache, disk, and recovery hardening

Status: **ROADMAP — DO NOT ASSIGN IN THE CURRENT iOS/SERVER MILESTONE**.

**Spec:** `feature/delivery-bundle-update/specs/v2/mobile/m07-cache-disk-recovery.md`

## Goal

Bound on-device storage and make interrupted transactions, missing files, low
disk, corruption, and concurrent pruning recover consistently on iOS/Android.

## Depends on

- [M04 — iOS activation/recovery](m04-prefetch-activation-recovery.md).
- [M05 — Android delivery/installation](m05-android-delivery-installation.md).
- [M06](m06-android-engine-reuse.md) only when reuse is enabled.

## Policy

```text
soft total managed cache:      250 MiB
ready releases per feature:           3
protect: active + previous + pending + attempting + in-use/in-flight
embedded baseline: read-only, outside quota, never deleted
```

## Requirements

- Track installed bytes/last-used metadata without hashing file contents.
- Evict only complete inactive releases using deterministic LRU.
- Never evict active, previous LKG, pending, attempting, mounted/in-use, or
  transaction content.
- Coordinate Android group release and platform view ownership before deletion.
- Preflight archive + declared expansion + safety margin, prune unprotected
  candidates, then fail low-disk without affecting current UI.
- Startup removes stale transactions/temporary directories and ignores/removes
  ready directories without valid completion markers.
- Missing structural cache falls active → previous → exact embedded baseline.
- Failed deletion is nonfatal and observable.
- Validated feature/release IDs are the only path inputs; no broad/globbed
  recursive-delete target.
- No normal recovery scans and rehashes every healthy release.

## Acceptance criteria

- [ ] Limit overflow evicts only least-recent inactive complete release.
- [ ] Protected/in-use releases and embedded resources survive pruning.
- [ ] Low disk aborts install while current mini-app remains usable.
- [ ] Stale transaction/incomplete ready data recovers after process death.
- [ ] Missing active directory falls to previous/exact embedded baseline.
- [ ] Concurrent open/install/prune cannot delete a used release.
- [ ] Cache report exposes safe sizes/IDs without PII/secret URLs.

## Required verification

Run both platform store/recovery/concurrency tests plus practical physical-device
low-disk/failure injection. Record exact scoped directories before/after prune.

## Out of scope

- Remote cache purge and SQLite until measured metadata scale requires it.
