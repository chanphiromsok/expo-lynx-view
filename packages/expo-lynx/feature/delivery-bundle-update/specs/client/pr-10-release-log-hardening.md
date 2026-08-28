# PR10 — Release log threshold hardening

**Spec:** feature/delivery-bundle-update/specs/client/pr-10-release-log-hardening.md

## Goal

Matches ../../ARCHITECTURE.md#production-rules exactly. Today this lives in the iOS module's `OnCreate`; this PR moves it into `LynxEnvironment` so it cannot be bypassed.

## Files

- `ios/LynxEnvironment.swift (assertion: threshold set before `LynxEnv.sharedInstance()`)`
- `ios/ExpoLynxModule.swift (remove the existing `SetMinimumLoggingLevel` call)`

## Contract

Pre-LynxEnv setup:
```swift
SetMinimumLoggingLevel(.error)
```
called before `LynxEnv.sharedInstance()`.

## Why

See [Architecture](../../ARCHITECTURE.md).

## Acceptance criteria

- [ ] Release build, exercise scrolling, no `[I:LynxEnv]`, no `[D:…]` lines
- [ ] The one expected `W/lynx: Reset minimum log level…` line is still present

## Out of scope

- Per-module log thresholds (use the global threshold)
