export default {
  appId: "default",
  featuresDir: "./features",
  // Host-only: these are embedded fallbacks, not mini-app release settings.
  features: ["delivery"],
  // These directories intentionally sit outside Metro's imported asset graph.
  embeddedOutputDir: "./generated/expo-lynx/embedded",
  releaseOutputDir: "./dist/lynx-releases",
};
