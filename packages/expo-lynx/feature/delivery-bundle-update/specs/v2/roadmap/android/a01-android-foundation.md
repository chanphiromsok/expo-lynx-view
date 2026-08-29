# A01 roadmap — Android Expo resources and trust foundation

Status: **ROADMAP — DO NOT ASSIGN IN THE CURRENT iOS/SERVER MILESTONE**.

## Goal when Android resumes

Extend the already-proven M02 configuration to Android without changing its
user-facing `embeddedBundlesPath`/`publicKeyPath` contract.

## Depends on when activated

- Completed M01–M04 and S01–S05 current milestone.
- [M02 — iOS Expo resources/trust](../../mobile/m02-trust-roots-signature-verification.md).
- Android milestone approval from [DEVELOPMENT-ROADMAP](../../DEVELOPMENT-ROADMAP.md).

## Future files

- Android branch of `packages/expo-lynx/app.plugin.js`
- `packages/expo-lynx/android/src/main/java/expo/modules/lynx/LynxSignatureVerifier.kt`
- Android plugin/resource and native signature tests

## Future requirements

- Copy the same validated generated baseline tree exactly once to:

```text
android/app/src/main/assets/expo-lynx/embedded/
  registry.json
  <feature>/baseline.json
  <feature>/main.lynx.bundle
  <feature>/static/**
```

- Embed only the SPKI public key, never private material.
- Keep generated baselines outside Metro/Expo normal assets and prove no
  duplicate APK copy.
- Implement strict unpadded base64url and `SHA256withRSA` verification over
  exact payload bytes.
- Parse only after signature success; require expected document type and exact
  requested feature before URLs/paths/state are used.
- Match M02 error codes and never perform network key discovery.
- Reuse the platform-neutral M01/S01 fixtures; mutation, wrong-type, and
  wrong-feature cases must fail.

## Future acceptance gate

- Android prebuild embeds exactly one resource tree/public key and no private
  key or Metro duplicate.
- TypeScript, Swift, and Kotlin verify the same valid fixture.
- Android Release rejects unsigned/wrongly signed remote envelopes.
- Android unit/build commands and an internal Release resource inspection pass.

After A01 is activated and complete, proceed to M05. Engine reuse remains M06,
after delivery correctness.
