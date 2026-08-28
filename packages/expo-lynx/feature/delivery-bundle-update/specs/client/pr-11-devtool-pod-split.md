# PR11 — DevTool pod split

**Spec:** feature/delivery-bundle-update/specs/client/pr-11-devtool-pod-split.md

## Goal

Release pod graph contains only runtime-required pods.

## Files

- `app.plugin.js (new `withLynxReleasePodConfig`)`
- `ios/ExpoLynx.podspec (no change, just verified via plugin)`
- `example/app.json (apply plugin)`

## Contract

Pods to exclude from Release: `LynxService/Devtool`, `LynxDevtool`, `DebugRouter`. Pods to keep: `Lynx`, `LynxService` (non-devtool modules).

## Why

See [Architecture](../../ARCHITECTURE.md).

## Acceptance criteria

- [ ] Release build: `pod install --release` does not link `LynxService/Devtool`, `LynxDevtool`, `DebugRouter`
- [ ] Debug build: all three still link and DevTool still attaches

## Out of scope

- Code stripping of unused symbols (separate concern)
