# M06 — iOS telemetry and internal Release E2E gate

## Goal

Make remote Lynx delivery diagnosable and prove the complete iOS lifecycle in
an internal Release build against the local signed static server before moving
to Cloudflare R2.

This is the final active iOS gate. It depends on the implementation slices, but
does not replace their unit or security tests.

## Scope

- Emit structured lifecycle events for fetch, response/cache, verification,
  extraction, install, staging, activation, fallback, rollback, and recovery.
- Include feature, channel, revision, release ID, phase, duration, byte counts,
  and a bounded error category; redact URLs with query tokens, credentials,
  signatures, keys, user data, and full payload contents.
- Measure download, verification, extraction, installation, candidate-load, and
  cache-hit timings without blocking the UI or RN JS thread.
- Add an internal Release E2E matrix on a physical iPhone using the LAN static
  server and at least two configured mini-app features.
- Document evidence capture and failure triage for implementation PRs.

## Required event contract

Every managed open must reach exactly one terminal outcome for the visible
content: `loaded-embedded`, `loaded-cached`, `loaded-remote`, `staged-next-open`,
`fallback`, or `error`. A channel update check may additionally end in
`no-update`, `staged`, `skipped-failed-release`, or a categorized failure, but
it must not replace the mounted view by itself.

## Acceptance criteria

- [ ] Telemetry distinguishes network, HTTP/cache, signature, compatibility,
      archive/path, disk, activation, watchdog, and recovery failures.
- [ ] No private key, bearer credential, tokenized URL, raw signed payload, or
      device identifier is emitted in routine logs.
- [ ] The E2E matrix proves embedded offline open and confirmed-cache offline
      open for each active feature.
- [ ] The matrix proves signed ZIP install, corrupt/tampered rejection,
      `next-open`, `on-launch`, force timing, rollback, process death, low disk,
      and failed-release loop prevention.
- [ ] A channel update check leaves the current Lynx view mounted; unchanged
      state performs no ZIP download; terminal `onStart` plus
      success/fallback/error callbacks are observable by the RN splash screen.
- [ ] Safe-area and container bounds remain stable during candidate load and
      fallback.
- [ ] Physical-device evidence records app build, iOS version, Lynx SDK,
      runtime version, channel revision, release ID, server address, and test
      result without secrets.

## Tests and evidence

- Unit tests for event redaction, terminal-state coverage, and error mapping.
- Integration tests against the local static server and deterministic M01/S01
  fixtures.
- A physical iPhone internal Release report with pass/fail evidence for every
  scenario in [TESTING.md](../../../TESTING.md).
- Run the [PR review checklist](../PR-REVIEW-CHECKLIST.md) and attach exact
  commands/results to the implementation PR.

## Dependencies and handoff

- Depends on M02–M05 and S04; S05 consumes the server-side portion of the final
  gate.
- Production readiness requires both this issue and S05 to pass.
- Android telemetry/E2E remains the roadmap item
  [`m08-mobile-telemetry-e2e.md`](./m08-mobile-telemetry-e2e.md).

## Out of scope

- Android implementation, Android engine reuse, or Android Release evidence.
- Automatic crash analytics vendor integration; provide a redacted event sink
  that can be connected later.
- Cloudflare production deployment or secret rotation.
