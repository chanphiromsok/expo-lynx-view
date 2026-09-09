import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { buildFeature, loadMiniAppConfigAsync } from './index.mjs';
import { readHost } from './host-runtime.mjs';

const ENTRY = 'main.lynx.bundle';

export async function embedMiniApp({
  cwd = process.cwd(),
  miniAppDirectory,
  buildFactory = buildFeature,
} = {}) {
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

  const embeddedRoot = resolve(host.root, host.embeddedBundlesPath);
  const registryPath = resolve(embeddedRoot, 'registry.json');
  const registry = existsSync(registryPath) ? readJson(registryPath) : { schemaVersion: 2, features: {}, runtimes: {} };
  if (registry.schemaVersion !== 2 || !registry.features || typeof registry.features !== 'object' || !registry.runtimes || typeof registry.runtimes !== 'object') {
    throw new Error(`Embedded registry uses an old or malformed layout. Remove ${embeddedRoot} and embed each mini app again.`);
  }

  const build = buildFactory(miniApp, miniApp.feature);
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
        schemaVersion: 2,
        feature: miniApp.feature,
        entry: ENTRY,
        files: build.files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })),
      });
      replaceDirectory(temporary, destination);
    } catch (error) {
      rmSync(temporary, { recursive: true, force: true });
      throw error;
    }

    registry.features[miniApp.feature] = {
      baseline: `${miniApp.feature}/baseline.json`,
    };
    writeJsonAtomic(registryPath, registry);
    return { appId: host.appId, feature: miniApp.feature, embeddedRoot };
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
