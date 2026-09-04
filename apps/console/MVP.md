# Console MVP

The implemented MVP is deliberately small. The full contract lives in the
three v2 specs linked from [SPEC.md](./SPEC.md).

```text
CLI
  build release.zip + unsigned release.json
  -> authenticate with one user-owned delivery API key
  -> upload ZIP directly to R2 with its local S3 credential
  -> complete registration

Console
  sign in with one username and password
  view registered bundles
  -> select or roll back one bundle
  -> enable/disable delivery
  -> optionally request force reload

Worker
  validate authenticated CLI uploads and ZIP checksum
  -> keep immutable metadata and one no-role user table in D1
  -> sign exact public deployment JSON bytes
```

There are no channels, environments, browser uploads, audits, release
envelopes, manifest objects, stored signatures, signing-key UI, or R2
credential UI. The console is the same Worker deployment as the public mobile
routes and is protected by an HTTP-only browser session. The Worker-only
delivery signing key still signs the public deployment response for mobile.

## Deferred roadmap

- **Revision rollover:** a deployment revision is monotonic per `(appId,
  feature)`. Uploading a bundle does not increment it; selecting a bundle,
  changing `enabled`, or requesting `force` does. Never reset or wrap it: a
  lower value is correctly rejected by mobile as a replay. If a real product
  ever approaches the 64-bit integer limit, add a signed delivery epoch and a
  native migration that scopes the stored revision by that epoch.
