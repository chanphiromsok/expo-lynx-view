# V2 PR review checklist

Use this checklist only after an implementation agent has opened a PR for one
V2 spec. The reviewer reads the exact spec named on the first non-blank PR line.

## Copy/paste review-agent prompt

```text
Review this PR against the exact V2 spec on the first non-blank PR-body line
and specs/v2/PR-REVIEW-CHECKLIST.md. Inspect the diff and current code; do not
trust the PR summary. Lead with concrete findings ordered by severity and cite
file/line locations. Run the spec-required automated checks. If this is a
mobile runtime PR and the target simulator/device is available, build and test
the applicable Release app scenarios; if it is a server PR, use isolated local
D1/R2 bindings. Do not deploy, publish, approve secrets, or change production
state. If no findings remain, state that explicitly and list every unverified
device/server risk. Do not modify the PR unless separately asked to fix it.
```

## 1. Scope and evidence

- [ ] PR names exactly one V2 spec.
- [ ] Every in-scope phase of the consolidated spec is complete; the PR does
      not stop at an unsafe temporary handoff that the merged spec was designed
      to eliminate.
- [ ] Diff stays inside the spec, or the PR explains every extra file.
- [ ] No unrelated formatting, generated native project churn, or lockfile
      rewrite is mixed into the change.
- [ ] PR lists commands actually run and their results.
- [ ] Acceptance criteria are backed by tests or explicit manual evidence.
- [ ] New dependencies have a license, maintenance, binary-size, and security
      justification.

## 2. Security invariants

- [ ] React Native never supplies an arbitrary executable production URL.
- [ ] Private signing keys and provider credentials are absent from the diff,
      fixtures, logs, and build output.
- [ ] `publicKeyPath` is resolved/contained by the Expo plugin and the plugin
      rejects inline/private/malformed key material.
- [ ] `embeddedBundlesPath` is generated outside Expo normal assets, copied once
      into native resources, and has no duplicate Metro/IPA/APK copy.
- [ ] Signature verification occurs before an archive is trusted.
- [ ] Archive extraction rejects traversal, absolute paths, backslashes,
      symlinks, duplicates, unexpected entries, and configured size limits.
- [ ] A hash or signature mismatch deletes staging and preserves current UI.
- [ ] `force` changes timing only; it does not bypass safety checks.
- [ ] Channel replay and downgrade rules use monotonic revision, not display
      version.
- [ ] Signature success is followed by exact signed document-type and requested-
      feature checks before any URL, cache path, or state namespace is used.
- [ ] The app embeds one public key only; no response-supplied key can become a
      trust root and no private key enters mobile resources.

## 3. Concurrency and lifecycle

- [ ] Network, hashing, and extraction stay off the UI/RN thread.
- [ ] UIKit/LynxView and Android View mutations occur on the platform UI thread.
- [ ] Cancellation or unmount cannot let stale work replace a newer source.
- [ ] Concurrent update checks for the same newly advertised release are
      deduplicated; unchanged/ready/pending releases make no ZIP request.
- [ ] Staging and final directories cannot expose a partial release.
- [ ] Active/pending pointers change only after the final release is complete.
- [ ] Process death during download, extraction, or candidate startup recovers
      deterministically.

## 4. Performance

- [ ] Cached open performs no full bundle/resource rehash.
- [ ] Extraction streams data and does not load the complete archive in memory.
- [ ] Disk preflight uses compressed plus declared uncompressed bytes and a
      safety margin.
- [ ] Progress callbacks are bounded and do not flood the RN bridge each byte.
- [ ] Visible UI does not wait for update checks when cache or embedded content
      is available.
- [ ] Embedded and cached opens use bounded structural checks only; expensive
      signature/archive/file hashes are installation/build-time work.
- [ ] Engine reuse, if present, is keyed by feature + release + template/group
      configuration and is optional for correctness.

## 5. Automated verification

Run commands required by the assigned spec. At minimum, when applicable:

```bash
pnpm run test
pnpm run lint
pnpm run build
pnpm --filter @expo-lynx/lynx-delivery-worker typecheck
```

Native PRs additionally require platform unit/build commands from the spec.
Never report a platform as verified because the other platform passed.

## 6. App check after PR

For mobile PRs that change runtime behavior, install a Release build on the
target platform. Record device OS, app build, feature, channel, release ID, and
channel revision.

Verify the spec-specific cases plus:

- [ ] Embedded baseline opens offline.
- [ ] Cached active release opens offline without a hash scan.
- [ ] New release reports download/extract/load progress.
- [ ] `next-open` keeps current UI and activates on the next open.
- [ ] Bad signature/hash/path/ZIP keeps current UI.
- [ ] Killing the app mid-transaction leaves no ready partial release.
- [ ] A failed candidate returns to previous LKG or embedded content.
- [ ] Splash/loading always reaches success, fallback, or error.
- [ ] Safe-area and container layout remain stable through loading/activation.

Capture screenshots or a short recording when the spec changes visible loading,
activation, rollback, or errors.

## 7. Server check after PR

For server PRs, test with an isolated local D1/R2 or Wrangler environment:

- [ ] Publish a release, read it back, and recompute the hash.
- [ ] Repeating the same upload is idempotent.
- [ ] Different bytes for an existing release ID are rejected.
- [ ] Public endpoint returns the signed bytes expected by mobile fixtures.
- [ ] ETag/304 and immutable Cache-Control behavior match the spec.
- [ ] Promote creates revision N+1.
- [ ] Rollback creates revision N+2 pointing to older bytes.
- [ ] Unauthorized mutation endpoints return 401/403 without changing state.
- [ ] D1/R2 contain no private signing key.

## 8. Review result

The review response must lead with findings ordered by severity and include
file/line references. If there are no findings, state that explicitly and list
remaining unverified risks or device/server checks. Do not approve based only on
the implementation agent's summary.
