# PR4 — Embedded baseline metadata

**Spec:** feature/delivery-bundle-update/specs/client/pr-04-embedded-baseline.md

## Goal

The shipped `static.lynx` carries a `manifest.json` next to it, recorded at build time. The client knows what version is embedded.

## Files

- `example/scripts/embed-baseline.sh (new — writes `manifest.json` alongside)`
- `example/app.json (config plugin ships both files)`
- `ios/LynxEmbeddedManifest.swift (new — read at startup)`

## Contract

Output manifest alongside `static.lynx`:
```json
{
  "feature": "delivery",
  "displayVersion": "1.0.0",
  "runtimeVersion": "expo-lynx-1-lynx-4.0.0",
  "bundle": { "path": "static.lynx", "sha256": "...", "bytes": 321726 },
  "resources": [{ "path": "static/image/logo.png", "sha256": "...", "bytes": 1245 }],
  "source": "embedded"
}
```

## Why

See [Architecture](../../ARCHITECTURE.md).

## Acceptance criteria

- [ ] Fresh offline install renders
- [ ] `LynxLoadEvent` reports `source: 'embedded'` with the recorded version

## Out of scope

- Hash verification of the embedded manifest (folded into PR3)
- Signature verification of app-packaged files; the signed app is the trust boundary
