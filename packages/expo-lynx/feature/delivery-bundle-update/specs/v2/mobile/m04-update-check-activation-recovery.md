# M04 — Feature deployment check, iOS force reload, activation, and recovery

**Spec:** `feature/delivery-bundle-update/specs/v2/mobile/m04-update-check-activation-recovery.md`

## Goal

Expose one feature-only React Native update-check API and connect it to the iOS
open lifecycle. The app renders a verified local source immediately, checks one
signed deployment endpoint, downloads only a newly selected release, and uses
the deployment's single `force` boolean to choose next-open activation or
reload of a mounted view.

`enabled` controls distribution only. Disabling prevents future discovery and
download; it never removes, deactivates, or rolls back a release already
downloaded by that device.

## Depends on

- [M01 — Shared release and deployment protocol](m01-shared-release-protocol.md).
- [M02 — Embedded registry and trust](m02-trust-roots-signature-verification.md).
- [M03 — iOS release installation](m03-ios-archive-installation.md).

## Files

- `packages/expo-lynx/src/ExpoLynx.types.ts`
- `packages/expo-lynx/src/ExpoLynxModule.ts`
- `packages/expo-lynx/src/LynxSource.ts`
- `packages/expo-lynx/src/index.ts`
- `packages/expo-lynx/app.plugin.js`
- `packages/expo-lynx/ios/ExpoLynxModule.swift`
- `packages/expo-lynx/ios/ExpoLynxView.swift`
- `packages/expo-lynx/ios/LynxManagedDeliveryCoordinator.swift`
- `packages/expo-lynx/ios/LynxManagedChannelState.swift` — rename to deployment state
- `packages/expo-lynx/ios/LynxManagedBundleStore.swift`
- focused TypeScript, Swift, plugin, and local delivery tests

## Contract

### React Native API

```ts
type CheckForUpdateResult =
  | {
      feature: string;
      status: 'disabled' | 'no-update';
      revision?: number;
    }
  | {
      feature: string;
      status: 'pending' | 'reloaded';
      revision: number;
      releaseId: string;
      version: string;
    };

type ExpoLynxModule = {
  checkForUpdate(options: {
    feature: LynxFeatureName;
  }): Promise<CheckForUpdateResult>;
};
```

JavaScript supplies only a canonical feature. It cannot supply a deployment
URL, release ID, public key, channel, activation mode, or force value.

Production managed sources require only their feature:

```ts
type ManagedLynxSource = {
  kind: 'managed';
  feature: LynxFeatureName;
};
```

### Build-time endpoint configuration

The Expo plugin validates one endpoint per embedded feature:

```json
{
  "deliveryEndpoints": {
    "delivery": "https://example.com/v1/default/delivery"
  }
}
```

It writes the native property-list map:

```text
ExpoLynxDeliveryEndpoints
  delivery -> https://example.com/v1/default/delivery
```

Production endpoints require HTTPS. HTTP remains limited to Debug or the
existing internal local-delivery build guard.

### Persistent state

State is serialized per feature, not per feature/channel:

```swift
struct LynxManagedState: Codable, Sendable {
  var activeReleaseID: String?
  var previousReleaseID: String?
  var pendingReleaseID: String?
  var attemptingReleaseID: String?
  var failedReleaseIDs: [String]
  var lastETag: String?
  var lastRevision: Int?
}
```

`enabled` is not local source state and is not persisted as a source-selection
flag. The state is one encoded value per scope in the dedicated native MMKV
store. The feature-only storage key is:

```text
expo.lynx.managed.v2.<feature>
```

### Open resolution

Render local content before waiting for the network:

```text
pending verified release -> attempt pending release
active verified release  -> use active release
otherwise                -> use embedded bundle
```

Only the exact embedded baseline for the requested feature is a fallback.
Never load a generic bundle or another feature.

### Deployment check and revision

Fetch the build-time endpoint with `If-None-Match` when an ETag exists. Verify
the M01 signature, document type, feature, revision, and exact enabled or
disabled variant before changing state.

```text
incoming revision > last revision
  accept once

incoming revision = last revision and exact ETag/body is unchanged
  no update

incoming revision = last revision with different bytes
  reject

incoming revision < last revision
  reject replay
```

A `304` preserves all local state. Network, HTTP, parsing, signature,
identity, revision, or storage failure also preserves the currently active,
pending, previous, and attempting releases.

### Disabled deployment

After verifying a newer signed `enabled: false` deployment:

- record revision, ETag, and check time;
- do not request a release manifest or ZIP;
- do not clear pending, active, previous, or attempting release IDs;
- do not delete verified release files;
- do not reload a mounted view; and
- return `status: 'disabled'`.

Disabled means the server is offering no release. Local source resolution does
not change:

```text
already active remote release -> keep it
already pending remote release -> attempt it on next open
older active remote release -> keep it
no local remote release -> use embedded
```

### Enabled deployment with `force: false`

- Record the accepted revision before processing the selected release.
- If the release is already active or pending, return `no-update` without a
  manifest or ZIP request.
- If the release is already installed, set it pending without downloading.
- Otherwise verify its release manifest through M01/M02 and install through
  M03.
- Store the verified release as pending and return `status: 'pending'`.
- Keep every currently mounted view unchanged.

On the next feature open, preserve active as previous, persist attempting
before rendering pending, and confirm active only after Lynx reports successful
main-bundle load. Load failure, timeout, or process death blocks the failed
immutable ID and restores previous or embedded.

### Enabled deployment with `force: true`

`force: true` is the only current-open timing instruction. There is no
separate activation field.

- If the selected release is not installed, download, verify, and install it
  completely while the current view stays visible.
- If it is already installed, reuse the verified local files.
- If no matching managed view is mounted, store the release as pending and use
  it on the next feature open.
- If a matching managed view is mounted, persist previous/attempting state and
  reload that view from the verified local release immediately after install.
- Return `status: 'reloaded'` only after the reload reaches the existing
  main-bundle health boundary.
- On reload failure or timeout, block the failed ID and reload previous or
  embedded.

“Immediately” means after that device polls the endpoint and completes
signature, compatibility, download, archive, file, and installation checks. It
does not mean server push at the moment an operator clicks the console.

An accepted revision is consumed once. Revalidation of the same revision or
`304` must not reload the view again. A newer revision may select the same
bundle with `force: true` to request another explicit reload.

### Rollback

Selecting an older release is accepted only through a newer signed deployment
revision. `force: false` applies that rollback next open; `force: true`
reloads the mounted view after the older release is verified locally. Bundle
age never controls replay protection.

### Concurrency and events

- Serialize transitions per feature.
- Deduplicate simultaneous checks and installs for the same feature/release.
- Keep network, hashing, ZIP, and file work off UI and React Native JS threads.
- Mutate Lynx views and emit React Native events on the platform UI thread.
- Ignore stale callbacks by source generation and release identity.
- Emit bounded phases: `checking`, `disabled`, `no-update`, `downloaded`,
  `staged`, `reloading`, `reloaded`, and `error`.
- Never expose URLs, headers, tokens, private paths, or bundle content in
  events.

## Requirements

- Resolve the endpoint only from validated build-time native configuration.
- Verify signed enabled and force values before using them.
- Treat disabled as “no new distribution,” not embedded fallback.
- Preserve every verified local release pointer and file when disabled.
- Apply `force: false` on next open and `force: true` after verified install.
- Never reload before signature, compatibility, archive, file, and installation
  checks succeed.
- Consume each force revision at most once.
- Preserve current local state on offline and every failed check.
- Keep feature isolation, atomic install, failed-ID blocking,
  last-known-good recovery, and embedded fallback safety.
- Remove production channel, separate activation, and caller-provided URL
  paths.

## Acceptance criteria

- [ ] The public JS API and managed source require only a canonical feature.
- [ ] The plugin embeds exactly one validated deployment endpoint per feature.
- [ ] JavaScript cannot override endpoint, release, key, enabled, force, or
      revision.
- [ ] Disabled performs no artifact request and preserves pending, active,
      previous, attempting, and verified files.
- [ ] A device with an active remote release keeps it after disable and reopen.
- [ ] A device with a pending verified release attempts it after disable and
      reopen.
- [ ] A device with no local remote release uses embedded while disabled.
- [ ] `force: false` installs a new release, keeps mounted UI, and stages it for
      next open.
- [ ] `force: true` keeps current UI through install, then reloads a matching
      mounted view from verified local files.
- [ ] `force: true` with no mounted view stores pending for next open.
- [ ] Force reload failure restores previous or embedded and blocks the failed
      release ID.
- [ ] Revalidating the same force revision never reloads twice.
- [ ] A newer force revision may reload the same verified release again.
- [ ] `304`, offline, HTTP error, malformed payload, bad signature, wrong type,
      wrong feature, and storage failure preserve local state.
- [ ] Lower revision and equal revision with different bytes fail without state
      mutation.
- [ ] A newer revision can select an older release for rollback with either
      force value.
- [ ] Duplicate callers perform at most one request, install, and reload for the
      accepted revision.

## Required verification

```bash
pnpm --filter expo-lynx exec jest --runInBand --no-watchman
node --test packages/expo-lynx/app.plugin.test.js
pnpm test:lynx-delivery
git diff --check
```

Run physical iOS internal Release cases for:

```text
first embedded open
enabled force=false -> download -> next-open activation
enabled force=true -> download -> mounted-view reload
enabled force=true + cached release -> no download -> reload once
enabled force=true + no mounted view -> pending next open
disable after active remote -> remote stays active
disable after pending download -> pending activates next open
disable before any remote download -> embedded remains
offline after disable -> current local source remains
newer revision selecting older release -> rollback
lower/equal-conflicting revision -> state unchanged
force reload error/timeout/process death -> previous or embedded
```

## Out of scope

- Server push or guaranteed wall-clock instant delivery.
- A separate `activation` enum or `next-open` field.
- Candidate-view swap or preserving page state across forced reload.
- Channels, multiple deployments per feature, cohorts, or percentage rollout.
- Background fetch and push-triggered updates.
- Android implementation and cache quota policy.
- Migration of pre-production channel-keyed state or cached files.
