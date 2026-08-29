export default {
  featuresDir: './features',
  features: {
    orders: {
      build: {
        command: process.execPath,
        args: ['./fake-build.mjs', 'orders', '{outputDir}'],
      },
    },
    shopping: {
      build: {
        command: process.execPath,
        args: ['./fake-build.mjs', 'shopping', '{outputDir}'],
      },
    },
  },
  embeddedOutputDir: './generated/expo-lynx/embedded',
  releaseOutputDir: './dist/lynx-releases',
  signing: {
    privateKeyPath: './keys/updates.private.pem',
  },
};
