export default {
  featuresDir: './features',
  features: {
    delivery: {
      build: {
        command: process.execPath,
        args: ['./scripts/build-delivery-runtime.mjs', '{outputDir}'],
      },
    },
  },
  // These directories intentionally sit outside Metro's imported asset graph.
  embeddedOutputDir: './generated/expo-lynx/embedded',
  releaseOutputDir: './dist/lynx-releases',
  signing: {
    privateKeyPath: './.local-lynx-keys/updates.private.pem',
  },
};
