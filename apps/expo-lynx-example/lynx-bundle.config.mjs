export default {
  appId: "default",
  featuresDir: "./features",
  features: {
    delivery: {},
  },
  // These directories intentionally sit outside Metro's imported asset graph.
  embeddedOutputDir: "./generated/expo-lynx/embedded",
  releaseOutputDir: "./dist/lynx-releases",
};
