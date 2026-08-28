# PR2 — Release-mode source guard

**Spec:** feature/delivery-bundle-update/specs/client/pr-02-release-source-guard.md

## Goal

Release builds reject `development`, `http://`, `file://`, and raw `https://`. Only `embedded` and `managed` allowed.

## Files

- `ios/ExpoLynxView.swift (add `resolveSource(_:)` that gates on `#if DEBUG`)`
- `example/App.tsx (gate `dev` URL button behind `__DEV__`)`

## Contract

```swift
func resolveSource(_ value: LynxSource) -> ResolvedSource {
#if DEBUG
  return resolveAny(value)
#else
  switch value.kind {
  case .embedded, .managed: return resolveManaged(value)
  case .development: fatalError("development source forbidden in Release")
  }
#endif
}
```

## Why

See [Architecture](../../ARCHITECTURE.md).

## Acceptance criteria

- [ ] Release build with `kind: 'development'` panics on launch with a clear message
- [ ] Debug build keeps working as today

## Out of scope

- Signed manifest verification (PR3)
- Cache directory / staging (PR5)
- Telemetry (PR8)
