# PR6 — Channel fetch + signed manifest

**Spec:** feature/delivery-bundle-update/specs/client/pr-06-channel-fetch-signed.md

## Goal

Release `managed` source fetches a signed channel pointer, verifies it, then downloads and verifies the referenced release manifest.

## Files

- `ios/LynxEnvironment.swift` (new — holds API base URL + public key)
- `ios/LynxChannelClient.swift` (new — fetches + verifies, compares against `LynxChannelState` from PR5)
- `ios/ExpoLynxModule.swift` (wire `LynxEnvironment` from `Constants.expoConfig.extra`)

## Contract

Channel pointer fetch flow:
1. GET `/channels/:feature/:channel` (signed pointer, 60s cache)
2. Verify Ed25519 with the public trust key embedded by `LynxEnvironment`.
3. Reject expired, replayed, or incompatible `runtimeVersion` pointers.
4. **Skip-check** against `crashHistory` in `LynxChannelState` (PR5). If the
   server's manifest ID is in the crash history, do NOT download. Emit
   `stage: 'crash_history'` and stop.
5. Resolve `manifestUrl` only after pointer verification.
6. Download manifest, verify its declared SHA-256 and Ed25519 signature.
7. Hand off to `LynxBundleStore` (PR5) for download.

The crash-history skip prevents an infinite download loop: if v3 was tried
last session and crashed before `notifyAppReady` fired (PR7's watchdog),
the next session must not re-download v3.

## Why

See [Architecture](../../ARCHITECTURE.md).

## Acceptance criteria

- [ ] Tamper the manifest in R2 → client refuses, emits `stage: 'signature'`
- [ ] Tamper or replay the channel pointer → client refuses before manifest fetch
- [ ] Good manifest → proceeds to download
- [ ] **A manifest ID in `crashHistory` is skipped without download**
- [ ] Requires server PRs S1, S3, S4 deployed. Otherwise point at a stub URL that returns a hand-signed manifest for local testing.

## Out of scope

- Channel switching at runtime (separate concern)
- LKG fallback (PR7)
- `notifyAppReady` watchdog (PR7)
