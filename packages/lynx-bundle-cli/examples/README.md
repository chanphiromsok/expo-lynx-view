# Delivery configuration examples

- `host-app/app.json` is the relevant Expo host configuration. Replace the
  placeholder Worker domain, but keep the canonical `/v1/<appId>/<feature>`
  path shape.
- `mini-app/lynx-miniapp.config.ts` is the complete configuration for one
  independently released mini app. It intentionally has no runtime, host path,
  feature map, signing key, or R2 credential.

The Console operator must register `bs-one / merchant-home` before either
example can contact the Worker.
