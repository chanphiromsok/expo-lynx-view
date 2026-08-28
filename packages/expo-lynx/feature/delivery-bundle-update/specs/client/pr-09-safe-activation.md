# PR9 — Activation mode (on-launch / next-open)

**Spec:** feature/delivery-bundle-update/specs/client/pr-09-safe-activation.md

## Goal

Respect the channel's declared activation mode. No background fetch, no
mid-session swap. `on-launch` swaps in the same launch; `next-open` stages
for the next launch.

## Files

- `ios/LynxBundleCoordinator.swift` (new — renders active cache or embedded, then checks once)
- `example/App.tsx` (declare `activation` in `LynxSource`)

## Contract

```swift
enum ActivationMode {
    case onLaunch   // download + verify + reload in this launch
    case nextOpen   // download + verify + stage; reload on next launch
}

func launchSequence(source: ManagedSource) async {
    renderActiveCacheOrEmbedded()
    let server = try? await fetchChannel()
    guard let server, server.manifestSha256 != local.last_manifest_id else { return }

    let staged = try await downloadAndVerify(server)
    switch source.activation {
    case .onLaunch:  apply(staged)            // swap LynxView to staged
    case .nextOpen:  savePending(staged)       // applied before the next launch check
    }
}
```

## Why

The coordinator makes one launch decision. It renders the confirmed cache or
embedded baseline immediately, then either activates the verified candidate
during that launch or records it for the next launch. It never starts a timer
or swaps because of a later background check.

## Acceptance criteria

- [ ] `kind: 'managed', activation: 'on-launch'` → new bundle renders within the same launch (verified: device shows vN+1 after first launch with that mode)
- [ ] `kind: 'managed', activation: 'next-open'` → current bundle stays visible; next launch attempts vN+1
- [ ] No timer or second update check triggers another activation later in the session
- [ ] No background fetch — fetch is gated by `viewDidAppear` / `onResume`, not a timer
- [ ] If `activation` is omitted from `LynxSource`, default to `'next-open'`
- [ ] A signed `force` pointer uses `on-launch` timing but keeps every verification and rollback rule

## Out of scope

- Mid-session swap with state preservation (deferred until someone asks)
- Background prefetch on a timer (explicitly rejected)
- Per-page activation mode (single mode per app, like Expo Updates)
