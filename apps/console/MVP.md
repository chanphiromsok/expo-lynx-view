# Console MVP

The implemented MVP is deliberately small. The full contract lives in the
three v2 specs linked from [SPEC.md](./SPEC.md).

```text
CLI
  build release.zip + unsigned release.json
  -> request a short-lived Worker upload instruction
  -> upload ZIP directly to R2
  -> complete registration

Console
  view registered bundles
  -> select or roll back one bundle
  -> enable/disable delivery
  -> optionally request force reload

Worker
  validate control requests and ZIP checksum
  -> keep immutable metadata in D1 bundles/deployments only
  -> sign exact public deployment JSON bytes
```

There are no channels, environments, browser uploads, audits, release
envelopes, manifest objects, stored signatures, signing-key UI, or R2
credential UI. The console is the same Worker deployment as the public mobile
routes and is protected by the in-memory control token entered by the operator.
