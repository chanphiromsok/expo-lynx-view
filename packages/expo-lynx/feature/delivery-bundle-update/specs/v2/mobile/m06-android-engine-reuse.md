# M06 — Optional Android same-release Lynx engine reuse

Status: **ROADMAP — DO NOT ASSIGN IN THE CURRENT iOS/SERVER MILESTONE**.

**Spec:** `feature/delivery-bundle-update/specs/v2/mobile/m06-android-engine-reuse.md`

## Goal

Add optional `LynxViewGroup`/`LynxEngine` reuse for repeated Android views of the
same verified release without making reuse part of update correctness.

## Depends on

- [M05 — Android delivery and installation](m05-android-delivery-installation.md).

## Requirements

- First prove the installed Lynx Android SDK exposes the documented group/cache
  API. If not, stop with evidence; do not upgrade Lynx in this PR.
- Reuse key includes feature, release ID (or embedded build fingerprint),
  template identity, and group/global configuration.
- Different release IDs/fingerprints never share an engine/group. A pending or
  forced update therefore gets a new identity even when feature is unchanged.
- Reference count/ownership is explicit; release groups when unused/evicted.
- Failed candidates never poison the active release's group.
- Cache is small/bounded and responds to memory pressure/component destroy.
- Development/HMR and managed production never share engines.
- Reuse-disabled behavior remains the correctness baseline and fallback.

## Acceptance criteria

- [ ] Re-entering the same release reuses only the intended group when enabled.
- [ ] New release/fingerprint creates a new group/engine.
- [ ] Disabling reuse preserves UI/events/activation/rollback behavior.
- [ ] Destroy/unmount/memory-pressure tests retain no Activity/View leak.
- [ ] Timing and memory before/after are recorded; no unmeasured claim.

## Required verification

Run Android unit/instrumentation tests and repeated open/close internal Release
loop with reuse on/off. Record SDK API evidence, timing, memory, and lifecycle.

## Out of scope

- iOS engine reuse, reuse across releases, SDK upgrade, or activation changes.
