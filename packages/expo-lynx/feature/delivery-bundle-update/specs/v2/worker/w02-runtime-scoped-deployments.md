# W02 — Scope deployments by native runtime

**Status:** planned; required before a public native upgrade

**Spec:** `feature/delivery-bundle-update/specs/v2/worker/w02-runtime-scoped-deployments.md`

## Goal

Let one Cloudflare Worker serve compatible bundles to old and new App Store
builds at the same time by making `runtimeVersion` part of deployment identity.

There is still one Worker, one Console, one R2 bucket, and no channels.

## Depends on

- [W01 — Cloudflare Worker upload, deployment, and delivery](w01-delivery-worker.md).
- [C02 — Native runtime fingerprint](../cli/c02-native-runtime-fingerprint.md).
- [M09 — Runtime-safe IFR launch](../mobile/m09-runtime-bound-cache.md).

## Owned files

- `apps/console/worker/`
- `apps/console/migrations/`
- `apps/console/src/features/delivery/`
- Worker, control API, and Console tests

## D1 change

Reuse `bundles.runtime_version` and add `runtime_version` only to the existing
deployment key:

```sql
CREATE TABLE deployments_next (
  app_id TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  runtime_version TEXT NOT NULL,
  bundle_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  force INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (app_id, feature_id, runtime_version)
);
```

Migration copies each existing deployment using its selected bundle's
`runtime_version`. A disabled row without a selected bundle may be omitted; it
has no release state to preserve in this pre-production migration.

No `fingerprints`, `runtimes`, `channels`, `apps`, or compatibility table is
added.

## Public request and response

Mobile sends its build-time runtime on the existing endpoint:

```http
GET /v1/:appId/:feature
lynx-runtime-version: <runtimeVersion>
```

The Worker validates the header as one bounded printable value before D1 work
and queries the exact `(appId, feature, runtimeVersion)` row. It never trusts a
runtime supplied by a release URL or response body to choose another row.

Both signed response variants contain the selected runtime so the response is
cryptographically bound to the request compatibility scope:

```json
{
  "schemaVersion": 1,
  "type": "lynx-deployment",
  "feature": "delivery",
  "runtimeVersion": "<expo-project-hash>",
  "revision": 1,
  "enabled": false,
  "issuedAt": "2026-09-04T00:00:00.000Z"
}
```

Mobile requires the signed `runtimeVersion` to equal its request value before
recording the ETag or revision. Missing runtime headers fail with a bounded
`400` response after the coordinated mobile rollout; there is no query-string
runtime or user credential in the public request.

No matching deployment is a signed disabled deployment for that runtime, not
an unsigned error and not a bundle from another runtime.

## Control API and Console

Deployment reads and mutations include `runtimeVersion` in their validated
scope. A selected bundle must match the same app, feature, and runtime.

The Console first selects `appId / feature`, then shows the runtime values that
already exist on uploaded bundles. Choosing a runtime displays and mutates only
its deployment and compatible bundles. No runtime is typed manually.

Revision and ETag replay protection remain independent per runtime. Promotion,
rollback, enable, disable, and force keep the W01 behavior within that runtime.

## Acceptance criteria

- [ ] D1 permits one deployment per `(appId, feature, runtimeVersion)` and no
      duplicate for that exact key.
- [ ] Public lookup never returns a bundle whose runtime differs from the
      validated request header.
- [ ] Enabled and disabled signed bodies both bind `runtimeVersion`.
- [ ] Mobile rejects a signed response for another runtime before state
      mutation or archive download.
- [ ] No matching runtime returns signed disabled state and performs no R2
      request.
- [ ] Console selection cannot attach an uploaded bundle to a deployment with a
      different runtime.
- [ ] Old and new runtime fixtures can each select, enable, revise, fetch, and
      download their own bundle from the same Worker.
- [ ] Disabling or forcing one runtime does not alter another runtime.
- [ ] Existing authentication, direct R2 upload, signing, and archive routes do
      not gain another credential or service.

## Required verification

```bash
pnpm --filter @expo-lynx/delivery-console typecheck
pnpm --filter @expo-lynx/delivery-console lint
pnpm --filter @expo-lynx/delivery-console test
pnpm --filter @expo-lynx/delivery-console build
git diff --check
```

The integration test uses two runtime strings against one app and feature. It
must not deploy Cloudflare resources or run a native build.

## Out of scope

- Channels, rollout cohorts, runtime aliases, semver compatibility ranges,
  automatic bundle promotion, multiple Workers, and a separate runtime table.
