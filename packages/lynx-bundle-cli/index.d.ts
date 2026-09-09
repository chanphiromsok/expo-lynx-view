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
  /** Worker namespace. Defaults to `default` for backward compatibility. */
  appId?: string;
  featuresDir?: string;
  features: Record<string, LynxFeatureConfig>;
  embeddedOutputDir: string;
  releaseOutputDir?: string;
};

export type EmbeddedRegistryV2 = {
  schemaVersion: 2;
  features: Record<string, { baseline: string }>;
  runtimes: Partial<Record<LynxDeliveryPlatform, {
    runtimeVersion: string;
    appVersion: string;
    buildNumber: string;
  }>>;
};

export type EmbeddedBaselineV2 = {
  schemaVersion: 2;
  feature: string;
  entry: 'main.lynx.bundle';
  files: Array<{ path: string; bytes: number; sha256: string }>;
};

export function defineConfig(config: LynxBundleConfig): LynxBundleConfig;
export type LynxMiniAppConfig = {
  appId: string;
  feature: string;
  releaseOutputDir?: string;
};
export function defineMiniApp(config: LynxMiniAppConfig): LynxMiniAppConfig;
export type LynxDeliveryPlatform = 'ios' | 'android';
export function createNativeRuntimeVersion(projectRoot: string, platform?: LynxDeliveryPlatform): Promise<string>;
export function readEmbeddedRuntimeVersion(config: LynxBundleConfig, platform?: LynxDeliveryPlatform): string;
