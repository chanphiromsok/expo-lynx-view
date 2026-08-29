export type LynxFeatureBuild = {
  /** Optional explicit production command. `{outputDir}` is replaced with a transaction directory. */
  command: string;
  args?: readonly string[];
};

export type LynxFeatureConfig = {
  entry?: string;
  lynxConfig?: string;
  /** Advanced escape hatch for a project-specific Rspeedy wrapper. */
  build?: LynxFeatureBuild;
};

export type LynxBundleConfig = {
  featuresDir?: string;
  features: Record<string, LynxFeatureConfig>;
  embeddedOutputDir: string;
  releaseOutputDir?: string;
  signing: { privateKeyPath: string };
};

export type EmbeddedRegistryV1 = {
  schemaVersion: 1;
  runtimeVersion: string;
  features: Record<string, { baseline: string; entry: string }>;
};

export type EmbeddedBaselineV1 = {
  schemaVersion: 1;
  feature: string;
  runtimeVersion: string;
  entry: 'main.lynx.bundle';
  inputFingerprint: string;
  files: Array<{ path: string; bytes: number; sha256: string }>;
};

export function defineConfig(config: LynxBundleConfig): LynxBundleConfig;
