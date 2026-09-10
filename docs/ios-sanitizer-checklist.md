# iOS sanitizer checklist — run before merging concurrency work

Gate for any change under Phase 1 of
[`ios-concurrency-lifecycle-remediation.md`](./ios-concurrency-lifecycle-remediation.md).
The `LynxInitialLoadGate` read-modify-write race (F1) is only reliably caught by
Thread Sanitizer; a plain functional pass will not surface it.

## One-time scheme setup (`apps/lynx-example`)

In Xcode, **Product ▸ Scheme ▸ Edit Scheme… ▸ Run ▸ Diagnostics**:

- [ ] **Thread Sanitizer** — on
- [ ] **Main Thread Checker** — on (with *Pause on issues*)
- [ ] Runtime API Checking — on

TSan and the Address Sanitizer are mutually exclusive; run ASan in a separate
pass if needed.

## Required runs

Exercise each path once on a debug build with the diagnostics above enabled:

- [ ] Cold managed-delivery load (pending → active → embedded fallback).
- [ ] Forced reload (`ExpoLynx.checkForUpdate` → `reloadMountedViews`).
- [ ] Load failure via an unreachable resource URL (404 / dropped connection) —
      confirm `handleError` is reached and `assertMain` does **not** trip.
- [ ] Unmount a view mid-load (navigate away before first screen).

## Pass criteria

- [ ] No TSan reports on `ExpoLynxView` state across the four runs.
- [ ] Main Thread Checker silent during mount and unmount.
- [ ] No `ECLynxThreadWrongThreadDestroyError` in the Lynx log on unmount.

Record the date, device/simulator, and Lynx pod version in the PR description.
