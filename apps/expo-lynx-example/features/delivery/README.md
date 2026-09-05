# Delivery mini-app

This directory is a mini-app workspace. Its only delivery identity is in
[`lynx-miniapp.config.ts`](./lynx-miniapp.config.ts): `default / delivery`.
It has no native runtime, signing key, Worker URL, or host build number.

```sh
# From this directory: build, package, upload, and verify a candidate.
pnpm release
```

The Console must already contain the `default / delivery` mini app and the
host team must have registered its current native build. Open the Console to
select the verified bundle and enable it.

The host app owns the embedded fallback and endpoint. From the repository root:

```sh
# Rebuild the embedded fallback after changing this source.
pnpm lynx bundle delivery

# Before making a native archive, record the matching host runtime.
cd apps/expo-lynx-example
pnpm exec lynx host prepare

# After the native archive has been built and approved.
pnpm exec lynx host register
```

Changing a later remote release only needs `pnpm release`; it does not need a
new native build.
