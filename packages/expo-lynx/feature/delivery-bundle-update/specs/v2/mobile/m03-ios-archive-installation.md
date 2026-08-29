# M03 — iOS hardened ZIP extraction and atomic release installation

**Spec:** `feature/delivery-bundle-update/specs/v2/mobile/m03-ios-archive-installation.md`

## Goal

Implement the complete iOS remote-release store: verify a signed release,
download into transaction staging, inspect/extract ZIP safely, verify exact
files once, atomically promote, and reopen completed releases through a cheap
cached fast path.

## Why these tasks are merged

The extractor is not a general ZIP utility; its safety depends on the signed
expected file set and the install transaction. Combining extraction and
installation ensures no caller can extract untrusted entries or mark a partial
directory ready.

## Depends on

- [M01 — Shared release protocol](m01-shared-release-protocol.md).
- [M02 — Native resources/trust verification](m02-trust-roots-signature-verification.md).
- [S04 — Local signed server](../server/s04-local-static-parity.md), or
  equivalent checked-in signed fixtures.
- Pinned Hot Updater archive review.

## Owned files

- `packages/expo-lynx/ios/LynxArchiveExtractor.swift`
- iOS archive limits/entry helpers as needed
- `LynxManagedManifest.swift`, `LynxManagedBundleStore.swift`, and completion
  metadata/state integration
- malicious ZIP, installer, interruption, and cached-fast-path tests
- third-party notices if substantial MIT source is ported

M04 owns the RN prefetch surface and view activation. This spec returns a
completed installed release only.

## Installation transaction

```text
fetch exact signed release envelope
  -> verify RSA-SHA256, type=lynx-release, requested feature, compatibility
  -> create app-private transaction directory
  -> download release.zip.part off main/RN threads
  -> verify declared length and archive SHA-256
  -> inspect central directory and free disk
  -> stream extract into sibling temporary directory
  -> verify exact declared file set, sizes, CRC, and SHA-256 once
  -> atomically write envelope + completion marker
  -> atomic rename to ready/<releaseId>
  -> delete staging archive
  -> return completed release
```

Staging and `ready` must share a filesystem under Application Support.
Deduplicate concurrent installs by feature + release ID. Do not change
active/pending state before final promotion succeeds.

## Hardened ZIP contract

- Support only tested standard stored/DEFLATE entries required by S01.
- Inspect central directory before writing output.
- Stream compressed/extracted data; never load the archive or expanded release
  wholly into memory.
- Reject encryption, unsupported ZIP64, symlinks/hard links/devices, absolute or
  drive paths, backslashes, NUL, empty/`.`/`..` components, excessive
  depth/length, destination escape, duplicate/colliding normalized paths, and
  entries absent from the signed payload.
- Apply M01 archive/expanded/entry/count/ratio limits before and during work.
- Verify actual expanded size and CRC32 for every entry.
- Any unsafe/unexpected entry fails the whole transaction; never silently skip.
- Extract only into the private transaction directory and delete partial output
  on failure.

## Completion and cached-open contract

The completion marker contains feature/release/manifest/archive identity and no
secret. A normal cached open checks only:

- completion marker and expected manifest identity;
- host/runtime compatibility;
- blocked/failed state;
- contained required entry existence.

It does not download or rehash the ZIP, bundle, and all resources again. Full
verification runs only for new installation, suspicious/incomplete recovery, or
explicit diagnostic repair.

The M02 embedded baseline follows the same fast-path principle: it was validated
during CLI/prebuild and authenticated by native app signing, remains read-only,
is not copied into the cache, and is not rehashed per open.

## Failure and progress behavior

- Cancellation, timeout, low disk, signature/hash, ZIP, file, or atomic-move
  failure deletes/quarantines the transaction and preserves active/LKG/embedded.
- Preflight requires archive + declared expansion + safety margin; extraction
  counters still enforce limits if metadata lies.
- Process death leaves no completed directory/pointer; startup removes stale
  transaction/incomplete ready directories.
- Progress has stable phases and coalesced monotonic values; it never emits one
  RN callback per byte.
- Preserve MIT notices if upstream code is substantially reused, but port the
  small required design rather than depending on the Hot Updater RN runtime.

## Acceptance criteria

- [ ] Valid signed local ZIP installs and loads on physical iPhone internal
      Release.
- [ ] Stored and DEFLATE fixtures extract byte-for-byte.
- [ ] Every traversal/type/collision/encryption/ZIP64/CRC/truncation/corruption/
      bomb/limit fixture fails with no escape or ready partial.
- [ ] Peak extraction memory is bounded by buffers/metadata, not archive size.
- [ ] Same-release concurrent requests perform one transaction.
- [ ] Kill during download/extract/promotion changes no pointer and recovers.
- [ ] Second open uses completion/path checks with no network or full hash scan.
- [ ] Every failure retains current UI capability and exact-feature embedded
      fallback remains usable offline.

## Required verification

- Run native extractor/store/transaction tests and shared malicious fixtures.
- Run `swiftc -parse` for standalone touched Swift files.
- Build iOS example Debug and Release.
- Run physical iOS internal Release valid, corrupt, low-disk, and interrupted
  cases; record directories and proof of cached fast path.

## Out of scope

- RN prefetch/events and activation/view replacement (M04).
- Android implementation (M05).
- TAR variants, deltas, or general archive extraction API.
