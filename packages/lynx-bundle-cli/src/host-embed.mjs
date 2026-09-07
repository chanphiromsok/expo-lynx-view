import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { buildFeature, createNativeRuntimeVersion, loadMiniAppConfigAsync } from './index.mjs';
import { readHost } from './host-runtime.mjs';

const ENTRY = 'main.lynx.bundle';

export async function embedMiniApp({
  cwd = process.cwd(),
  miniAppDirectory,
  platform = 'ios',
  runtimeFactory = createNativeRuntimeVersion,
  buildFactory = buildFeature,
} = {}) {
  if (platform !== 'ios') {
    throw new Error('Android managed delivery is not implemented in expo-lynx-view. Do not embed an Android baseline.');
  }
  if (typeof miniAppDirectory !== 'string' || miniAppDirectory.length === 0) {
    throw new Error('A mini-app directory is required. Use lynx host embed <mini-app-directory>.');
  }

  const host = readHost(cwd);
  const miniApp = await loadMiniAppConfigAsync({ cwd: resolve(host.root, miniAppDirectory) });
  if (miniApp.appId !== host.appId) {
    throw new Error(`Mini app ${miniApp.appId}/${miniApp.feature} does not belong to host app ${host.appId}.`);
  }
  if (!host.features.includes(miniApp.feature)) {
    throw new Error(`Mini app feature ${miniApp.feature} is missing from expo-lynx-view deliveryEndpoints.`);
  }

  const runtimeVersion = await runtimeFactory(host.root, platform);
  const build = buildFactory(miniApp, miniApp.feature);
  const embeddedRoot = resolve(host.root, host.embeddedBundlesPath);
  const destination = resolve(embeddedRoot, miniApp.feature);
  try {
    mkdirSync(embeddedRoot, { recursive: true, mode: 0o700 });
    const temporary = mkdtempSync(resolve(embeddedRoot, `.${miniApp.feature}.tmp-`));
    try {
      for (const file of build.files) {
        const output = resolve(temporary, file.path);
        mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
        copyFileSync(file.absolutePath, output);
      }
      writeJson(resolve(temporary, 'baseline.json'), {
        schemaVersion: 1,
        feature: miniApp.feature,
        runtimeVersion,
        entry: ENTRY,
        inputFingerprint: build.inputFingerprint,
        files: build.files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })),
      });
      replaceDirectory(temporary, destination);
    } catch (error) {
      rmSync(temporary, { recursive: true, force: true });
      throw error;
    }

    const registryPath = resolve(embeddedRoot, 'registry.json');
    const registry = existsSync(registryPath) ? readJson(registryPath) : { schemaVersion: 1, runtimeVersion, features: {} };
    if (registry.schemaVersion !== 1 || !registry.features || typeof registry.features !== 'object') {
      throw new Error(`Embedded registry is malformed: ${registryPath}`);
    }
    registry.runtimeVersion = runtimeVersion;
    registry.features[miniApp.feature] = {
      baseline: `${miniApp.feature}/baseline.json`,
      entry: `${miniApp.feature}/${ENTRY}`,
    };
    writeJsonAtomic(registryPath, registry);
    return { appId: host.appId, feature: miniApp.feature, platform, runtimeVersion, embeddedRoot };
  } finally {
    rmSync(build.outputDirectory, { recursive: true, force: true });
  }
}

function replaceDirectory(temporary, destination) {
  const backup = `${destination}.previous-${process.pid}-${Date.now()}`;
  const hadDestination = existsSync(destination);
  try {
    if (hadDestination) renameSync(destination, backup);
    renameSync(temporary, destination);
    if (hadDestination) rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (!existsSync(destination) && hadDestination && existsSync(backup)) renameSync(backup, destination);
    throw error;
  }
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { throw new Error(`Embedded registry could not be read: ${path}`); }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp`;
  writeJson(temporary, value);
  renameSync(temporary, path);
}
