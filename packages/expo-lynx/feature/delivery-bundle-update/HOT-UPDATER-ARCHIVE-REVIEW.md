# Hot Updater Mobile Archive Review

Status: pinned upstream extraction reference for the V2 architecture. This is
not an implementation spec and does not import Hot Updater into `expo-lynx`.

Reviewed upstream:

- repository: [gronxb/hot-updater](https://github.com/gronxb/hot-updater)
- commit: [`5463bdd81ed4c21041c4cb6cf0049bdf25fa2ffb`](https://github.com/gronxb/hot-updater/tree/5463bdd81ed4c21041c4cb6cf0049bdf25fa2ffb)
- license: [MIT](https://github.com/gronxb/hot-updater/blob/5463bdd81ed4c21041c4cb6cf0049bdf25fa2ffb/LICENSE)

The review uses an exact upstream commit so future Hot Updater changes do not
silently change this architecture decision.

## Recommendation

Do not maintain a full Hot Updater fork for Lynx delivery. Hot Updater owns a
global React Native OTA lifecycle, while this project needs independent
per-feature Lynx releases.

Reuse the small native archive ideas under the MIT license, with attribution,
and harden them for signed Lynx release manifests. If substantial upstream code
is copied, preserve the MIT copyright and license notice in the copied module.

## Upstream archive flow

Both platforms follow the same high-level lifecycle:

```text
update request
  -> reuse cached release directory if structurally valid
  -> otherwise download archive into bundle-temp
  -> compare HTTP size when Content-Length is known
  -> verify archive SHA-256 or RSA-SHA256 signature
  -> create bundle-store/<bundleId>.tmp
  -> extract archive off the UI thread
  -> validate the expected platform bundle exists
  -> move <bundleId>.tmp to bundle-store/<bundleId>
  -> persist the new bundle as staging
  -> keep stable + staging bundles
  -> clean archive temp files and older releases
```

Download progress occupies approximately 0–80% and extraction occupies
80–100%.

Hot Updater's current source also contains a manifest-driven asset installation
path and falls back to a complete archive when that path is unavailable or
fails. ZIP is therefore an archive fallback/packaging path, not the only
possible delivery model.

## iOS architecture

Relevant upstream files:

- [BundleFileStorageService.swift](https://github.com/gronxb/hot-updater/blob/5463bdd81ed4c21041c4cb6cf0049bdf25fa2ffb/packages/react-native/ios/HotUpdater/Internal/BundleFileStorageService.swift)
- [DecompressService.swift](https://github.com/gronxb/hot-updater/blob/5463bdd81ed4c21041c4cb6cf0049bdf25fa2ffb/packages/react-native/ios/HotUpdater/Internal/DecompressService.swift)
- [ZipDecompressionStrategy.swift](https://github.com/gronxb/hot-updater/blob/5463bdd81ed4c21041c4cb6cf0049bdf25fa2ffb/packages/react-native/ios/HotUpdater/Internal/ZipDecompressionStrategy.swift)
- [ZipArchiveExtractor.swift](https://github.com/gronxb/hot-updater/blob/5463bdd81ed4c21041c4cb6cf0049bdf25fa2ffb/packages/react-native/ios/HotUpdater/Internal/ZipArchiveExtractor.swift)
- [ArchiveExtractionUtilities.swift](https://github.com/gronxb/hot-updater/blob/5463bdd81ed4c21041c4cb6cf0049bdf25fa2ffb/packages/react-native/ios/HotUpdater/Internal/ArchiveExtractionUtilities.swift)
- [URLSessionDownloadService.swift](https://github.com/gronxb/hot-updater/blob/5463bdd81ed4c21041c4cb6cf0049bdf25fa2ffb/packages/react-native/ios/HotUpdater/Internal/URLSessionDownloadService.swift)

The iOS package uses a strategy abstraction for ZIP, TAR.GZ, and TAR.BR. ZIP
handling is implemented in Swift with `zlib`, not a third-party ZIP framework.

The custom ZIP extractor:

- reads the central directory before extraction;
- supports stored and DEFLATE entries;
- rejects encrypted entries;
- rejects ZIP64 entries;
- normalizes relative paths;
- rejects absolute paths, drive-letter paths, backslashes, `.` and `..`;
- checks that standardized output paths remain inside the destination;
- skips Unix symbolic-link entries;
- streams input/output in bounded chunks;
- validates each entry's uncompressed size and CRC32.

File work runs on a dedicated file-operation queue. The archive is verified
before extraction. Extraction targets `<bundleId>.tmp`, and a successful
directory is moved to `<bundleId>` before the staging pointer is saved.

## Android architecture

Relevant upstream files:

- [BundleFileStorageService.kt](https://github.com/gronxb/hot-updater/blob/5463bdd81ed4c21041c4cb6cf0049bdf25fa2ffb/packages/react-native/android/src/main/java/com/hotupdater/BundleFileStorageService.kt)
- [DecompressService.kt](https://github.com/gronxb/hot-updater/blob/5463bdd81ed4c21041c4cb6cf0049bdf25fa2ffb/packages/react-native/android/src/main/java/com/hotupdater/DecompressService.kt)
- [ZipDecompressionStrategy.kt](https://github.com/gronxb/hot-updater/blob/5463bdd81ed4c21041c4cb6cf0049bdf25fa2ffb/packages/react-native/android/src/main/java/com/hotupdater/ZipDecompressionStrategy.kt)
- [RelativePathResolver.kt](https://github.com/gronxb/hot-updater/blob/5463bdd81ed4c21041c4cb6cf0049bdf25fa2ffb/packages/react-native/android/src/main/java/com/hotupdater/RelativePathResolver.kt)
- [OkHttpDownloadService.kt](https://github.com/gronxb/hot-updater/blob/5463bdd81ed4c21041c4cb6cf0049bdf25fa2ffb/packages/react-native/android/src/main/java/com/hotupdater/OkHttpDownloadService.kt)

Android uses the platform ZIP classes: `ZipFile` for validation and size
enumeration, then `ZipInputStream` for streaming extraction. Work runs on
`Dispatchers.IO`.

The Android ZIP strategy:

- validates minimum archive size and ZIP magic bytes;
- opens the first entry to validate the archive structure;
- resolves each entry through a canonical containment check;
- rejects absolute paths, drive-letter paths, backslashes, `.` and `..`;
- streams extraction instead of loading the complete archive into memory;
- calculates and validates CRC32 per entry;
- reports extraction progress from total declared uncompressed bytes.

The archive is verified before extraction, extraction targets
`<bundleId>.tmp`, and the staging pointer is written after the final directory
and platform bundle exist.

## Patterns to adopt

| Pattern | Lynx decision |
|---|---|
| Verify archive before extraction | Adopt. Verify signed manifest, archive bytes, and archive SHA-256 first. |
| Extract off the UI/RN thread | Adopt. Swift actor/queue on iOS and coroutine IO dispatcher on Android. |
| Release-specific temporary directory | Adopt as `ready/<releaseId>.tmp` or sibling staging directory. |
| Final same-volume directory move | Adopt. The active pointer changes only after the move succeeds. |
| Keep stable and staging releases | Adopt for candidate verification and rollback. |
| Streaming extraction | Adopt to bound memory use. |
| Path normalization and containment | Adopt and make rejection fatal for the whole release. |
| CRC32 validation | Adopt as archive-structure validation, in addition to signed SHA-256. |
| Progress split between download/extract | Adopt, but expose named phases rather than relying only on percentages. |
| Cached release fast path | Adopt. Do not rehash already installed bundle/resource bytes on every open. |
| Stale `.tmp` cleanup | Adopt during recovery and before a new transaction. |

## Upstream behavior to harden

### Unsafe entries must fail the release

The reviewed ZIP extractors skip some invalid paths or symbolic links and
continue extracting other entries. For a signed release, any unsafe or
unexpected archive entry indicates a build or integrity problem. The Lynx
installer must reject the complete release instead of silently skipping it.

### Add zip-bomb limits

The reviewed archive flow has no explicit global limit for:

- number of entries;
- total uncompressed bytes;
- compression ratio;
- maximum size of one entry;
- nested path depth.

The current disk-space estimate is based on approximately twice the compressed
download size, which can underestimate a highly compressed archive.

The signed Lynx manifest must declare archive and extracted sizes. Before
extraction, compare central-directory totals with these limits:

```text
max archive bytes
max total uncompressed bytes
max entry count
max single entry bytes
max compression ratio
max path length and depth
```

Disk-space preflight should use:

```text
archive bytes
+ declared extracted bytes
+ safety margin
```

### Reject duplicate output paths

The Lynx installer must reject duplicate normalized entry paths. Otherwise a
later entry can overwrite an earlier extracted file.

### Do not auto-detect the signed release format

Hot Updater tries format strategies by magic bytes and uses TAR.BR as a final
fallback. V2 explicitly declares `zip`. Native validates the expected
magic/structure and rejects ZIP64, another archive format, or a mismatch. A
future format requires a new reviewed protocol version; it is not auto-detected.

### Require atomic completion semantics

Android has rename, move, and copy fallbacks. A recursive copy fallback is not
atomic and can leave a partially populated final directory after process death.

For Lynx:

1. Place staging and final directories on the same filesystem.
2. Prefer a final atomic rename.
3. If a platform fallback copy is unavoidable, copy into another temporary
   directory, write a completion marker, then rename that directory.
4. Never point active/pending state at a directory without the completion
   marker.

### Keep Application Support semantics on iOS

Hot Updater stores its iOS bundle store under its documents path. The existing
Lynx implementation uses Application Support, which is the preferred semantic
location for app-managed internal releases. Do not copy the upstream directory
choice unchanged.

## Lynx archive contract

Recommended R2/static layout:

```text
<feature>/releases/<releaseId>/manifest.json
<feature>/releases/<releaseId>/release.zip
```

The decoded release payload inside the signed envelope includes:

```json
{
  "type": "lynx-release",
  "feature": "shopping",
  "releaseId": "shopping-001",
  "format": "zip",
  "archive": {
    "url": "release.zip",
    "bytes": 2123456,
    "sha256": "...",
    "uncompressedBytes": 4987654,
    "entryCount": 8
  },
  "files": [
    {
      "path": "main.lynx.bundle",
      "bytes": 1843920,
      "sha256": "...",
      "required": true
    }
  ]
}
```

These are decoded payload bytes. The outer V2 envelope contains the algorithm,
base64url payload, and RSA-SHA256 signature; mobile uses one embedded app-wide
public key and requires this signed type/feature before installation.

Installation verifies the archive and extracted files once. Cached launches do
only the already-approved cheap structural checks.

## Fork decision

| Option | Assessment |
|---|---|
| Full GitHub fork of Hot Updater | Not recommended. It creates a large upstream merge and security-maintenance obligation for unrelated React Native OTA behavior. |
| Git submodule/subtree | Not recommended for a small extraction surface. |
| Depend on `@hot-updater/react-native` | Not recommended. It owns global RN bundle selection and reload behavior. |
| Selective native port with MIT attribution | Recommended if the custom extractor is preferred. Pin the reviewed commit and add Lynx-specific hardening/tests. |
| Independent ZIP library | Also viable. Compare maintenance, binary size, supported formats, and security behavior before the mobile spec is approved. |

## Accepted V2 decisions

These decisions are implemented through the consolidated M03 iOS installation
and M05 Android delivery/installation specifications:

- ZIP is the only release package format in the first production phase.
- The full Hot Updater repository is not embedded or used as the Lynx runtime updater.
- Copied extraction code retains MIT attribution and pins the reviewed commit.
- Unsafe, duplicate, unexpected, or oversized entries fail the complete release.
- The signed payload declares format, archive bytes, expanded bytes, entry count, and expected files.
- Archive and extracted-file verification occur only during installation.
- Cached opens do not rehash healthy release bytes.
- Final activation requires a same-volume atomic move or a completion-marker equivalent.
- iOS stays under Application Support; Android stays under app-internal files.
- Extraction progress and errors use the common mobile event contract.
