# M05 — iOS cache, disk, retention, and recovery hardening

## Goal

Make the iOS managed-bundle store resilient to interrupted writes, process
death, low disk, stale metadata, eviction, and repeated opens across multiple
mini-app features.

This slice builds on [M03](./m03-ios-archive-installation.md) and
[M04](./m04-update-check-activation-recovery.md). It does not add Android behavior;
Android cache parity remains in the roadmap.

## Scope

- Define the app-private directory layout for `ready/`, `staging/`, metadata,
  active, pending, attempting, and previous-LKG state.
- Serialize state transitions so only a complete installed directory can become
  active, pending, or attempting.
- Reconcile state after process death and remove abandoned staging or incomplete
  ready directories without scanning every healthy release.
- Enforce archive/expanded-size reservations, free-space checks, quotas, and a
  protected-release eviction order.
- Isolate cache namespaces by canonical feature, channel, runtime version, and
  release ID.
- Keep cached opens on the bounded fast path: metadata and expected-entry checks
  only; no full signature/archive/file rehash after installation.

## Required state invariants

1. Embedded content is immutable and never evicted.
2. Active, attempting, pending, and previous-LKG releases are protected from
   eviction until their state is safely advanced or cleared.
3. A staging directory is never rendered and cannot become ready without a
   completed install marker and atomic promotion.
4. An `attemptingReleaseId` found on startup is treated as an unconfirmed
   candidate, recorded as failed, and rolled back to previous LKG or embedded.
5. A failed immutable release ID is not retried in a boot loop; a fixed package
   must have a new release ID.
6. Metadata and pointers are written atomically and are recoverable after a
   torn write.

## Acceptance criteria

- [ ] Repeated opens use bounded metadata/entry checks and do not redo the full
      expensive verification performed by M03.
- [ ] Process death during download, extraction, promotion, or candidate load
      never selects an incomplete release.
- [ ] Low disk and quota failures retain a usable active release or embedded
      baseline and clean up temporary state.
- [ ] Eviction never removes embedded, active, attempting, pending, or previous
      LKG content.
- [ ] Two configured mini-app features cannot read or evict each other’s cache.
- [ ] Startup reconciliation is idempotent and covered by deterministic tests.

## Tests and evidence

- Native unit tests for state transitions, atomic metadata writes, reconciliation,
  quota/eviction ordering, and feature isolation.
- Fault-injection tests for process death and low-disk conditions at each
  install boundary.
- An internal Release run proving offline cached open, pending next-open
  activation, candidate failure rollback, and safe-area/container stability.

## Dependencies and handoff

- Depends on M03, M04, and the M01 protocol invariants.
- Supplies durable cache/recovery behavior to M06 and the final iOS Release
  gate.
- Android cache/disk/recovery remains the roadmap item
  [`m07-cache-disk-recovery.md`](./m07-cache-disk-recovery.md).

## Out of scope

- Android implementation or `LynxEngine` reuse.
- SQLite or a general-purpose database; the initial state store remains the
  small native metadata store defined by the architecture.
- Delta packages, background OS downloads, or mid-session replacement.
