# PR8 — Telemetry + structured errors

**Spec:** feature/delivery-bundle-update/specs/client/pr-08-telemetry-errors.md

## Goal

Every load emits a `LynxLoadEvent`; every failure emits a `LynxErrorEvent` with a normalized stage.

## Files

- `ios/LynxTelemetry.swift (new)`
- `ios/ExpoLynxView.swift (wire events)`
- `example/App.tsx (optional: forward to your sink)`

## Contract

Telemetry rules — see ../../TESTING.md:
- NO `initialData`
- NO query strings
- NO auth headers
- Allowed: feature, version, source tier, stage names, durations, fallback path

## Why

See [Architecture](../../ARCHITECTURE.md).

## Acceptance criteria

- [ ] Exercise every failure path
- [ ] Confirm telemetry contains stage names from the enum, never a URL with `?token=…`

## Out of scope

- Telemetry sink integration (your backend)
- Sampling / aggregation (out of scope for client)
