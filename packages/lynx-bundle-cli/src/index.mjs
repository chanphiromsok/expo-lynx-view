import {
  createHash,
} from 'node:crypto';
import { createProjectHashAsync } from '@expo/fingerprint';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

export const PROTOCOL_LIMITS = Object.freeze({
  maxArchiveBytes: 64 * 1024 * 1024,
  maxUncompressedBytes: 256 * 1024 * 1024,
  maxSingleEntryBytes: 64 * 1024 * 1024,
  maxEntries: 4096,
  maxCompressionRatio: 100,
  maxPathUtf8Bytes: 512,
  maxPathDepth: 16,
});

const FEATURE_ID = /^[a-z][a-z0-9-]{0,63}$/;
const APP_ID = /^[a-z][a-z0-9-]{0,63}$/;
const RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DISPLAY_VERSION = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,127}$/;
const SHA_256 = /^[a-f0-9]{64}$/;
const ENTRY = 'main.lynx.bundle';

export function defineConfig(config) {
  return config;
}

/** The entire public configuration surface for one independent mini app. */
export function defineMiniApp(config) {
  return config;
}

export function loadConfig({ configPath, cwd = process.cwd() } = {}) {
  const path = findConfigPath(configPath, cwd);
  const raw = loadConfigModule(path);
  return normalizeConfig(raw, path);
}

export function buildFeature(config, featureId) {
  const feature = getFeature(config, featureId);
  const cacheRoot = resolve(config.configDirectory, 'node_modules/.cache/expo-lynx');
  mkdirSync(cacheRoot, { recursive: true, mode: 0o700 });
  const outputDirectory = mkdtempSync(resolve(cacheRoot, `${featureId}-`));
  try {
    runFeatureBuild(config, feature, outputDirectory);
    return {
      feature: featureId,
      outputDirectory,
      files: inspectRuntimeFiles(outputDirectory),
      inputFingerprint: featureInputFingerprint(config, feature),
    };
  } catch (error) {
    rmSync(outputDirectory, { recursive: true, force: true });
    throw error;
  }
}

export function buildEmbedded(config, featureIds, runtimeVersion) {
  assertVersion(runtimeVersion, 'runtimeVersion');
  const selected = selectFeatures(config, featureIds);
  const destination = config.embeddedOutputDir;
  const temporary = createSiblingTemporaryDirectory(destination);
  try {
    const registry = { schemaVersion: 1, runtimeVersion, features: {} };
    for (const featureId of selected) {
      const build = buildFeature(config, featureId);
      try {
        const featureDirectory = resolve(temporary, featureId);
        mkdirSync(featureDirectory, { recursive: true, mode: 0o700 });
        copyRuntimeFiles(build.outputDirectory, featureDirectory, build.files);
        const files = fileMetadata(featureDirectory);
        const baseline = {
          schemaVersion: 1,
          feature: featureId,
          runtimeVersion,
          entry: ENTRY,
          inputFingerprint: build.inputFingerprint,
          files,
        };
        writeJson(resolve(featureDirectory, 'baseline.json'), baseline);
        registry.features[featureId] = {
          baseline: `${featureId}/baseline.json`,
          entry: `${featureId}/${ENTRY}`,
        };
      } finally {
        rmSync(build.outputDirectory, { recursive: true, force: true });
      }
    }
    registry.features = sortObject(registry.features);
    writeJson(resolve(temporary, 'registry.json'), registry);
    verifyEmbeddedTree(temporary, config, runtimeVersion, selected);
    atomicReplaceDirectory(temporary, destination);
    return { outputDirectory: destination, registry };
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

export function checkEmbedded(config, runtimeVersion) {
  assertVersion(runtimeVersion, 'runtimeVersion');
  return verifyEmbeddedTree(config.embeddedOutputDir, config, runtimeVersion, selectFeatures(config));
}

export async function createNativeRuntimeVersion(projectRoot) {
  const runtimeVersion = await createProjectHashAsync(projectRoot);
  assertVersion(runtimeVersion, 'Expo native runtime fingerprint');
  return runtimeVersion;
}

export function readEmbeddedRuntimeVersion(config) {
  const registry = parseJson(
    readFileSync(resolve(config.embeddedOutputDir, 'registry.json')),
    'Embedded registry'
  );
  if (!isObject(registry) || registry.schemaVersion !== 1 || !isObject(registry.features)) {
    throw new Error('Embedded registry is malformed. Build the embedded baseline for the intended native app first.');
  }
  assertVersion(registry.runtimeVersion, 'Embedded registry runtimeVersion');
  return registry.runtimeVersion;
}

export function packRelease(config, options) {
  const { featureId, releaseId, version, platform, runtimeVersion } = options;
  const feature = getFeature(config, featureId);
  assertReleaseId(releaseId);
  assertDisplayVersion(version);
  if (platform !== 'ios') throw new Error('Release packaging currently supports iOS only.');
  if (runtimeVersion !== undefined) assertVersion(runtimeVersion, 'runtimeVersion');

  const build = buildFeature(config, feature.id);
  const releaseDirectory = options.outputWithFeature === false
    ? resolve(config.releaseOutputDir, releaseId)
    : resolve(config.releaseOutputDir, feature.id, releaseId);
  const temporary = createSiblingTemporaryDirectory(releaseDirectory);
  try {
    const files = inspectRuntimeFiles(build.outputDirectory);
    const archive = createDeterministicZip(build.outputDirectory, files);
    const archiveHash = sha256(archive);
    const release = runtimeVersion === undefined
      ? {
          schemaVersion: 2,
          appId: config.appId,
          feature: feature.id,
          releaseId,
          version,
          archiveSha256: archiveHash,
          archiveBytes: archive.byteLength,
        }
      : {
          schemaVersion: 1,
          appId: config.appId,
          feature: feature.id,
          releaseId,
          version,
          runtimeVersion,
          archiveSha256: archiveHash,
          archiveBytes: archive.byteLength,
        };
    writeFileSync(resolve(temporary, 'release.zip'), archive, { mode: 0o600 });
    writeJson(resolve(temporary, 'release.json'), release);
    atomicReplaceDirectory(temporary, releaseDirectory);
    return { outputDirectory: releaseDirectory, release };
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  } finally {
    rmSync(build.outputDirectory, { recursive: true, force: true });
  }
}

function findConfigPath(configPath, cwd) {
  if (configPath) {
    const path = resolve(cwd, configPath);
    if (!existsSync(path)) throw new Error(`Config file was not found: ${path}`);
    return path;
  }
  for (const name of ['lynx-bundle.config.ts', 'lynx-bundle.config.mjs', 'lynx-bundle.config.js']) {
    const path = resolve(cwd, name);
    if (existsSync(path)) return path;
  }
  throw new Error(`No lynx-bundle.config.ts, .mjs, or .js found below ${cwd}.`);
}

function loadConfigModule(path) {
  const extension = path.slice(path.lastIndexOf('.'));
  if (extension === '.ts') {
    const script = `const mod = await import(${JSON.stringify(pathToFileURL(path).href)}); process.stdout.write(JSON.stringify(mod.default));`;
    const result = spawnSync(process.execPath, ['--experimental-transform-types', '--input-type=module', '--eval', script], {
      encoding: 'utf8',
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
    if (result.status !== 0) throw new Error(`Unable to load ${path}: ${result.stderr.trim()}`);
    return parseJson(Buffer.from(result.stdout), 'Config');
  }
  throw new Error('JavaScript config loading is async; use loadConfigAsync for .mjs/.js configs.');
}

export async function loadConfigAsync({ configPath, cwd = process.cwd() } = {}) {
  const path = findConfigPath(configPath, cwd);
  if (path.endsWith('.ts')) return loadConfig({ configPath: path, cwd: '/' });
  const module = await import(pathToFileURL(path).href);
  return normalizeConfig(module.default, path);
}

export async function loadMiniAppConfigAsync({ configPath, cwd = process.cwd() } = {}) {
  const path = findMiniAppConfigPath(configPath, cwd);
  const raw = path.endsWith('.ts')
    ? loadConfigModule(path)
    : (await import(pathToFileURL(path).href)).default;
  return normalizeMiniAppConfig(raw, path);
}

export function packMiniAppRelease(config, { releaseId, version }) {
  return packRelease(config, {
    featureId: config.feature,
    releaseId,
    version,
    platform: 'ios',
    outputWithFeature: false,
  });
}

function normalizeConfig(raw, configPath) {
  if (!isObject(raw)) throw new Error('lynx-bundle config must export an object.');
  const configDirectory = dirname(configPath);
  const allowed = new Set(['appId', 'featuresDir', 'features', 'embeddedOutputDir', 'releaseOutputDir']);
  assertKnownKeys(raw, allowed, 'config');
  const appId = raw.appId ?? 'default';
  if (typeof appId !== 'string' || !APP_ID.test(appId)) throw new Error('config.appId must be a lowercase identifier.');
  const featureIds = Array.isArray(raw.features)
    ? raw.features
    : (isObject(raw.features) ? Object.keys(raw.features) : null);
  if (!featureIds || featureIds.length === 0 || !featureIds.every((featureId) => typeof featureId === 'string')) {
    throw new Error('config.features must be a non-empty array of feature IDs or a legacy feature object.');
  }
  if (typeof raw.embeddedOutputDir !== 'string' || !raw.embeddedOutputDir) throw new Error('config.embeddedOutputDir is required.');
  const featuresDirectory = resolveContained(configDirectory, raw.featuresDir ?? '.');
  const seenPaths = new Set();
  const features = {};
  for (const featureId of [...featureIds].sort()) {
    assertFeatureId(featureId);
    const rawFeature = Array.isArray(raw.features) ? {} : raw.features[featureId];
    if (!isObject(rawFeature)) throw new Error(`Feature ${featureId} must be an object.`);
    assertKnownKeys(rawFeature, new Set(['entry', 'lynxConfig', 'build']), `feature ${featureId}`);
    const root = resolveContained(featuresDirectory, featureId);
    if (seenPaths.has(root.toLowerCase())) throw new Error(`Feature roots collide on a case-insensitive filesystem: ${featureId}`);
    seenPaths.add(root.toLowerCase());
    const entry = rawFeature.entry ?? './src/index.tsx';
    const lynxConfig = rawFeature.lynxConfig ?? './lynx.config.ts';
    if (typeof entry !== 'string' || typeof lynxConfig !== 'string') throw new Error(`Feature ${featureId} entry and lynxConfig must be strings.`);
    const build = normalizeBuild(rawFeature.build, configDirectory, featureId);
    features[featureId] = {
      id: featureId,
      root,
      entry: resolveContained(root, entry),
      lynxConfig: resolveContained(root, lynxConfig),
      build,
    };
  }
  return {
    configPath,
    configDirectory,
    appId,
    featuresDirectory,
    features,
    embeddedOutputDir: resolveContained(configDirectory, raw.embeddedOutputDir),
    releaseOutputDir: resolveContained(configDirectory, raw.releaseOutputDir ?? './dist/lynx-releases'),
  };
}

function findMiniAppConfigPath(configPath, cwd) {
  if (configPath) {
    const path = resolve(cwd, configPath);
    if (!existsSync(path)) throw new Error(`Mini-app config file was not found: ${path}`);
    return path;
  }
  for (const name of ['lynx-miniapp.config.ts', 'lynx-miniapp.config.mjs', 'lynx-miniapp.config.js']) {
    const path = resolve(cwd, name);
    if (existsSync(path)) return path;
  }
  throw new Error(`No lynx-miniapp.config.ts, .mjs, or .js found below ${cwd}.`);
}

function normalizeMiniAppConfig(raw, configPath) {
  if (!isObject(raw)) throw new Error('lynx-miniapp config must export an object.');
  assertKnownKeys(raw, new Set(['appId', 'feature', 'releaseOutputDir']), 'mini-app config');
  if (typeof raw.appId !== 'string' || !APP_ID.test(raw.appId)) throw new Error('mini-app appId must be a lowercase identifier.');
  if (typeof raw.feature !== 'string' || !FEATURE_ID.test(raw.feature)) throw new Error('mini-app feature must be a lowercase identifier.');
  if (raw.releaseOutputDir !== undefined && (typeof raw.releaseOutputDir !== 'string' || !raw.releaseOutputDir)) {
    throw new Error('mini-app releaseOutputDir must be a non-empty relative path.');
  }
  const configDirectory = dirname(configPath);
  const feature = {
    id: raw.feature,
    root: configDirectory,
    entry: resolveContained(configDirectory, './src/index.tsx'),
    lynxConfig: resolveContained(configDirectory, './lynx.config.ts'),
    build: null,
  };
  return {
    configPath,
    configDirectory,
    appId: raw.appId,
    feature: raw.feature,
    features: { [raw.feature]: feature },
    releaseOutputDir: resolveContained(configDirectory, raw.releaseOutputDir ?? './dist/lynx-releases'),
  };
}

function normalizeBuild(raw, configDirectory, featureId) {
  if (raw === undefined) return null;
  if (!isObject(raw) || typeof raw.command !== 'string' || !raw.command) throw new Error(`Feature ${featureId}.build.command must be a string.`);
  if (raw.args !== undefined && (!Array.isArray(raw.args) || !raw.args.every((item) => typeof item === 'string'))) {
    throw new Error(`Feature ${featureId}.build.args must be a string array.`);
  }
  assertKnownKeys(raw, new Set(['command', 'args']), `feature ${featureId}.build`);
  return { command: raw.command, args: raw.args ?? [], configDirectory };
}

function getFeature(config, featureId) {
  assertFeatureId(featureId);
  const feature = config.features[featureId];
  if (!feature) throw new Error(`Feature is not configured: ${featureId}`);
  if (!existsSync(feature.root) || !lstatSync(feature.root).isDirectory()) throw new Error(`Feature root is missing: ${feature.root}`);
  if (!existsSync(feature.entry) || !lstatSync(feature.entry).isFile()) throw new Error(`Feature entry is missing: ${feature.entry}`);
  if (!existsSync(feature.lynxConfig) || !lstatSync(feature.lynxConfig).isFile()) throw new Error(`Feature Lynx config is missing: ${feature.lynxConfig}`);
  assertRealpathContained(config.configDirectory, feature.root, `Feature root for ${featureId}`);
  assertRealpathContained(feature.root, feature.entry, `Feature entry for ${featureId}`);
  assertRealpathContained(feature.root, feature.lynxConfig, `Feature config for ${featureId}`);
  return feature;
}

function selectFeatures(config, requested = []) {
  const selected = requested.length === 0 ? Object.keys(config.features) : [...new Set(requested)];
  for (const featureId of selected) getFeature(config, featureId);
  return [...selected].sort();
}

function runFeatureBuild(config, feature, outputDirectory) {
  const build = feature.build ?? defaultBuild(feature, outputDirectory);
  const args = build.args.map((argument) => resolveBuildArgument(argument, outputDirectory, build.configDirectory ?? config.configDirectory));
  try {
    const result = spawnSync(build.command, args, {
      cwd: feature.root,
      stdio: 'inherit',
      env: { ...process.env, LYNX_BUNDLE_OUTPUT_DIR: outputDirectory },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Feature ${feature.id} production build failed with exit code ${result.status}.`);
  } finally {
    // The transient Rspeedy config lives in the build directory so Rspeedy can
    // import it. It is tooling input, not a publishable Lynx resource.
    build.cleanup?.();
  }
}

function defaultBuild(feature, outputDirectory) {
  const temporaryConfig = resolve(outputDirectory, 'lynx-bundle.rspeedy.config.mjs');
  const content = [
    `import config from ${JSON.stringify(pathToFileURL(feature.lynxConfig).href)};`,
    // Rspeedy validates the Lynx environment against its current DistPath
    // object shape. The string form is accepted by some Rsbuild environments,
    // but is rejected by Rspeedy's Lynx config validator.
    `export default { ...config, output: { ...(config.output ?? {}), distPath: { root: ${JSON.stringify(outputDirectory)} } } };`,
  ].join('\n');
  writeFileSync(temporaryConfig, content, { mode: 0o600 });
  const workspaceRoot = findPnpmWorkspaceRoot(feature.root);
  const command = workspaceRoot || existsSync(resolve(feature.root, 'pnpm-lock.yaml')) ? 'pnpm' : 'npm';
  const args = command === 'pnpm'
    ? [...(workspaceRoot ? ['--dir', feature.root] : []), 'exec', 'rspeedy', 'build', '--environment', 'lynx', '--root', feature.root, '--config', temporaryConfig]
    : ['exec', '--', 'rspeedy', 'build', '--environment', 'lynx', '--root', feature.root, '--config', temporaryConfig];
  return {
    command,
    args,
    configDirectory: feature.root,
    cleanup: () => rmSync(temporaryConfig, { force: true }),
  };
}

function findPnpmWorkspaceRoot(startDirectory) {
  let directory = startDirectory;
  while (true) {
    if (existsSync(resolve(directory, 'pnpm-workspace.yaml'))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function resolveBuildArgument(argument, outputDirectory, configDirectory) {
  const replaced = argument.replaceAll('{outputDir}', outputDirectory);
  if (replaced.startsWith('./') || replaced.startsWith('../')) return resolve(configDirectory, replaced);
  return replaced;
}

function inspectRuntimeFiles(directory) {
  const files = walkFiles(directory);
  if (files.length === 0) throw new Error('Rspeedy build did not produce runtime files.');
  for (const file of files) {
    if (file.path !== ENTRY && !file.path.startsWith('static/')) {
      throw new Error(`Unexpected publishable build output: ${file.path}`);
    }
  }
  const main = files.filter((file) => file.path === ENTRY);
  if (main.length !== 1) throw new Error('Rspeedy build must produce exactly one main.lynx.bundle.');
  validateFileSet(files);
  return files;
}

function copyRuntimeFiles(source, destination, files) {
  for (const file of files) {
    const target = resolve(destination, file.path);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    cpSync(resolve(source, file.path), target, { force: true, dereference: false });
  }
}

function fileMetadata(directory) {
  return walkFiles(directory)
    .filter((file) => file.path !== 'baseline.json')
    .map(({ path, bytes, sha256: hash }) => ({ path, bytes, sha256: hash }));
}

function walkFiles(directory, prefix = '') {
  if (!existsSync(directory) || !lstatSync(directory).isDirectory()) throw new Error(`Expected directory: ${directory}`);
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = resolve(directory, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Symlinks are forbidden in release output: ${relativePath}`);
      if (entry.name.startsWith('.')) throw new Error(`Dotfiles are forbidden in release output: ${relativePath}`);
      if (entry.isDirectory()) return walkFiles(path, relativePath);
      if (!entry.isFile()) throw new Error(`Unsupported release output entry: ${relativePath}`);
      assertSafePath(relativePath);
      const bytes = statSync(path).size;
      return [{ path: relativePath, bytes, sha256: sha256(readFileSync(path)), absolutePath: path }];
    });
}

function validateFileSet(files) {
  if (files.length > PROTOCOL_LIMITS.maxEntries) throw new Error('Release exceeds the entry-count limit.');
  const seen = new Set();
  let totalBytes = 0;
  for (const file of files) {
    assertSafePath(file.path);
    const storagePath = file.path.normalize('NFC').toLowerCase();
    if (seen.has(storagePath)) throw new Error(`Release contains duplicate path: ${file.path}`);
    seen.add(storagePath);
    if (!Number.isSafeInteger(file.bytes) || file.bytes <= 0 || file.bytes > PROTOCOL_LIMITS.maxSingleEntryBytes) {
      throw new Error(`Invalid release file size: ${file.path}`);
    }
    totalBytes += file.bytes;
  }
  if (totalBytes > PROTOCOL_LIMITS.maxUncompressedBytes) throw new Error('Release exceeds the uncompressed-size limit.');
}

function createDeterministicZip(root, files) {
  const ordered = [...files].sort((left, right) => left.path.localeCompare(right.path));
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const file of ordered) {
    const content = readFileSync(resolve(root, file.path));
    const name = Buffer.from(file.path, 'utf8');
    const checksum = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, content);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(0x0314, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(0x0021, 14);
    header.writeUInt32LE(checksum, 16);
    header.writeUInt32LE(content.length, 20);
    header.writeUInt32LE(content.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE((0o100644 * 0x10000) >>> 0, 38);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);
    offset += local.length + name.length + content.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(ordered.length, 8);
  end.writeUInt16LE(ordered.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  const archive = Buffer.concat([...chunks, centralBytes, end]);
  if (archive.length > PROTOCOL_LIMITS.maxArchiveBytes) throw new Error('Release exceeds the archive-size limit.');
  return archive;
}

function verifyEmbeddedTree(directory, config, runtimeVersion, expectedFeatures) {
  const registry = parseJson(readFileSync(resolve(directory, 'registry.json')), 'Embedded registry');
  if (!isObject(registry) || registry.schemaVersion !== 1 || registry.runtimeVersion !== runtimeVersion || !isObject(registry.features)) {
    throw new Error('Embedded registry is malformed or has the wrong runtime version.');
  }
  const actualFeatures = Object.keys(registry.features).sort();
  if (JSON.stringify(actualFeatures) !== JSON.stringify([...expectedFeatures].sort())) throw new Error('Embedded registry feature set is stale.');
  for (const featureId of actualFeatures) {
    const entry = registry.features[featureId];
    if (!isObject(entry) || entry.baseline !== `${featureId}/baseline.json` || entry.entry !== `${featureId}/${ENTRY}`) {
      throw new Error(`Embedded registry entry is invalid for ${featureId}.`);
    }
    const baselinePath = resolveContained(directory, entry.baseline);
    const baseline = parseJson(readFileSync(baselinePath), `Embedded baseline ${featureId}`);
    if (!isObject(baseline) || baseline.schemaVersion !== 1 || baseline.feature !== featureId || baseline.runtimeVersion !== runtimeVersion || baseline.entry !== ENTRY || !Array.isArray(baseline.files)) {
      throw new Error(`Embedded baseline is malformed for ${featureId}.`);
    }
    if (baseline.inputFingerprint !== featureInputFingerprint(config, getFeature(config, featureId))) {
      throw new Error(`Embedded baseline is stale for ${featureId}.`);
    }
    const featureDirectory = resolve(directory, featureId);
    const actual = fileMetadata(featureDirectory);
    const declared = baseline.files;
    if (JSON.stringify(actual) !== JSON.stringify(declared)) throw new Error(`Embedded baseline files are stale or incomplete for ${featureId}.`);
    if (!existsSync(resolveContained(featureDirectory, ENTRY))) throw new Error(`Embedded baseline is missing ${ENTRY} for ${featureId}.`);
  }
  return registry;
}

function featureInputFingerprint(config, feature) {
  const files = sourceFiles(feature.root, feature.root).map((file) => ({ path: file.path, sha256: file.sha256 }));
  return sha256(Buffer.from(JSON.stringify({ feature: feature.id, entry: relative(feature.root, feature.entry), lynxConfig: relative(feature.root, feature.lynxConfig), files }), 'utf8'));
}

function sourceFiles(directory, root) {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') return [];
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symlinks are forbidden in feature source: ${path}`);
      if (entry.isDirectory()) return sourceFiles(path, root);
      if (!entry.isFile()) return [];
      const pathFromRoot = relative(root, path).split(sep).join('/');
      assertSafePath(pathFromRoot);
      return [{ path: pathFromRoot, sha256: sha256(readFileSync(path)) }];
    });
}


function createSiblingTemporaryDirectory(destination) {
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  return mkdtempSync(resolve(dirname(destination), `.${basename(destination)}.tmp-`));
}

function atomicReplaceDirectory(temporary, destination) {
  const backup = resolve(dirname(destination), `.${basename(destination)}.previous-${process.pid}-${Date.now()}`);
  let movedExisting = false;
  try {
    if (existsSync(destination)) {
      renameSync(destination, backup);
      movedExisting = true;
    }
    renameSync(temporary, destination);
    if (movedExisting) rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (!existsSync(destination) && movedExisting && existsSync(backup)) renameSync(backup, destination);
    throw error;
  }
}

function basename(path) {
  const parts = path.split(sep);
  return parts[parts.length - 1];
}

function resolveContained(root, requested) {
  if (typeof requested !== 'string' || !requested || requested.includes('\0')) throw new Error('Path must be a non-empty string.');
  const destination = resolve(root, requested);
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (destination !== root && !destination.startsWith(rootPrefix)) throw new Error(`Path escapes its configured root: ${requested}`);
  return destination;
}

function assertRealpathContained(root, candidate, label) {
  const realRoot = realpathSync(root);
  const realCandidate = realpathSync(candidate);
  const prefix = realRoot.endsWith(sep) ? realRoot : `${realRoot}${sep}`;
  if (realCandidate !== realRoot && !realCandidate.startsWith(prefix)) {
    throw new Error(`${label} resolves outside its configured root.`);
  }
}

function assertSafePath(path) {
  const bytes = Buffer.byteLength(path, 'utf8');
  if (!path || bytes > PROTOCOL_LIMITS.maxPathUtf8Bytes || path.startsWith('/') || path.includes('\\') || path.includes('\0')) throw new Error(`Unsafe release path: ${path}`);
  const parts = path.split('/');
  if (parts.length > PROTOCOL_LIMITS.maxPathDepth || parts.some((part) => !part || part === '.' || part === '..')) throw new Error(`Unsafe release path: ${path}`);
  for (const part of parts) {
    let decoded;
    try { decoded = decodeURIComponent(part); } catch { throw new Error(`Invalid percent encoding in path: ${path}`); }
    if (!decoded || decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\') || decoded.includes('\0')) throw new Error(`Unsafe release path: ${path}`);
  }
}

function assertFeatureId(featureId) {
  if (typeof featureId !== 'string' || !FEATURE_ID.test(featureId)) throw new Error('Feature ID must match ^[a-z][a-z0-9-]{0,63}$.');
}

function assertReleaseId(releaseId) {
  if (typeof releaseId !== 'string' || !RELEASE_ID.test(releaseId)) throw new Error('Release ID is not safe.');
}

function assertDisplayVersion(version) {
  if (typeof version !== 'string' || !DISPLAY_VERSION.test(version)) throw new Error('Release version is not safe.');
}

function assertVersion(value, field) {
  if (typeof value !== 'string' || !value || value.length > 128 || /[\x00-\x1f\x7f]/.test(value)) throw new Error(`${field} must be a non-empty printable string.`);
}

function assertKnownKeys(object, allowed, label) {
  for (const key of Object.keys(object)) if (!allowed.has(key)) throw new Error(`Unknown ${label} field: ${key}`);
}

function parseJson(bytes, label) {
  try { return JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { throw new Error(`${label} is not valid JSON.`); }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}


function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sortObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([left], [right]) => left.localeCompare(right)));
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
