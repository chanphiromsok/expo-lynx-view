# `@expo-lynx/bundle-cli`

`lynx-bundle` is the producer-side boundary for V2 Lynx mini-app releases. It
builds each configured feature in isolation, generates embedded native-resource
input, creates a deterministic stored ZIP, and signs exact payload bytes with
one app-wide RSA key.

It does not copy resources into an Expo project, download releases, or upload
to Cloudflare. Those concerns belong to M02–M04 and S02–S04.

## Configuration

Create `lynx-bundle.config.ts` in the consuming app repository. Feature-map
keys are canonical; `shopping` automatically resolves to
`<featuresDir>/shopping`, so do not repeat a feature ID or project root.

```ts
import { defineConfig } from '@expo-lynx/bundle-cli';

export default defineConfig({
  featuresDir: './features',
  features: {
    shopping: {},
    orders: { entry: './src/main.tsx' },
  },
  embeddedOutputDir: './generated/expo-lynx/embedded',
  releaseOutputDir: './dist/lynx-releases',
  signing: {
    privateKeyPath:
      process.env.LYNX_SIGNING_PRIVATE_KEY_PATH ??
      './.local-lynx-keys/updates.private.pem',
  },
});
```

By default a feature must contain `src/index.tsx` and `lynx.config.ts`.
The CLI runs its Lynx environment Rspeedy build with a temporary output path;
the accepted output is exactly `main.lynx.bundle` plus `static/**` sidecars.

`feature.build` is an advanced project-specific wrapper only. It receives an
`{outputDir}` argument placeholder and must write the same accepted output
tree. It is useful for a bespoke build wrapper, but is not a way to relax the
file-set checks.

## Commands

```bash
# One-time local development key; do not commit the private output.
pnpm lynx-bundle keys generate --output-dir .local-lynx-keys

# Build all features into the dedicated native-resource input tree.
pnpm lynx-bundle build-embedded --runtime-version expo-57
pnpm lynx-bundle check-embedded --runtime-version expo-57

# Create release.zip, exact unsigned payload bytes, signature envelope, report.
pnpm lynx-bundle pack shopping \
  --release-id shopping-2026.08.29.1 \
  --version 2026.08.29.1 \
  --platform ios \
  --runtime-version expo-57

# Sign an existing exact JSON payload without parsing/reserializing its bytes.
pnpm lynx-bundle sign-channel ./channel-payload.json --output ./channel-envelope.json
```

`build-embedded` writes under `generated/expo-lynx/embedded`, deliberately
outside Expo's normal asset graph. It is input to the M02 config plugin and is
not imported by Metro. `pack` writes under `dist/lynx-releases` and needs no
Expo prebuild for an already-declared feature.

The private key is PKCS#8 PEM with mode `0600`; the public key is SPKI PEM.
The package uses RSA PKCS#1 v1.5 with SHA-256 (`RSA-SHA256`) and unpadded
base64url signatures. It signs the exact payload file bytes—never a parsed and
reserialized equivalent.

S01 packages **iOS only**. Android remains intentionally deferred to the V2
Android roadmap; the protocol reserves the platform value but this CLI will not
publish an Android artifact yet.
