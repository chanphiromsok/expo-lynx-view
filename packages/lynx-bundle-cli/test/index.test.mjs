import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  buildEmbedded,
  checkEmbedded,
  loadConfigAsync,
  packRelease,
} from '../src/index.mjs';

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/app');

async function temporaryApp() {
  const root = mkdtempSync(resolve(tmpdir(), 'lynx-bundle-cli-test-'));
  cpSync(fixtureRoot, root, { recursive: true });
  const config = await loadConfigAsync({ configPath: resolve(root, 'lynx-bundle.config.mjs') });
  return { root, config };
}

test('resolves two canonical feature roots and builds an atomic embedded tree', async () => {
  const { root, config } = await temporaryApp();
  assert.equal(config.features.shopping.root, resolve(root, 'features/shopping'));
  assert.equal(config.features.orders.root, resolve(root, 'features/orders'));

  const built = buildEmbedded(config, [], 'expo-57');
  assert.deepEqual(Object.keys(built.registry.features), ['orders', 'shopping']);
  assert.deepEqual(checkEmbedded(config, 'expo-57').features, built.registry.features);
  assert.equal(
    readFileSync(resolve(root, 'generated/expo-lynx/embedded/shopping/main.lynx.bundle'), 'utf8').includes('shopping'),
    true
  );

  writeFileSync(resolve(root, 'features/shopping/src/index.tsx'), "export const miniApp = 'shopping-v2';\n");
  assert.throws(() => checkEmbedded(config, 'expo-57'), /stale/);
});

test('loads a TypeScript config through the public defineConfig helper shape', async () => {
  const { root } = await temporaryApp();
  const sourcePath = resolve(dirname(fileURLToPath(import.meta.url)), '../src/index.mjs').replaceAll('\\', '\\\\');
  writeFileSync(
    resolve(root, 'lynx-bundle.config.ts'),
    `import { defineConfig } from '${sourcePath}';\nexport default defineConfig({ featuresDir: './features', features: { shopping: {} }, embeddedOutputDir: './generated/expo-lynx/embedded' });\n`
  );
  const config = await loadConfigAsync({ configPath: resolve(root, 'lynx-bundle.config.ts') });
  assert.equal(config.features.shopping.root, resolve(root, 'features/shopping'));
});

test('rejects a feature-directory symlink that resolves outside the consuming repository', async () => {
  const { root, config } = await temporaryApp();
  const externalRoot = mkdtempSync(resolve(tmpdir(), 'lynx-bundle-cli-external-'));
  const originalFeatures = resolve(root, 'features');
  renameSync(originalFeatures, resolve(externalRoot, 'features'));
  symlinkSync(resolve(externalRoot, 'features'), originalFeatures, 'dir');
  assert.throws(() => buildEmbedded(config, [], 'expo-57'), /resolves outside/);
});

test('produces deterministic ZIP bytes and the minimal unsigned release metadata', async () => {
  const { root, config } = await temporaryApp();
  const options = {
    featureId: 'shopping',
    releaseId: 'shopping-2026.08.29.1',
    version: '2026.08.29.1',
    platform: 'ios',
    runtimeVersion: 'expo-57',
  };
  const first = packRelease(config, options);
  const firstZip = readFileSync(resolve(first.outputDirectory, 'release.zip'));
  const firstRelease = readFileSync(resolve(first.outputDirectory, 'release.json'));
  const archiveCheck = spawnSync('unzip', ['-t', resolve(first.outputDirectory, 'release.zip')], {
    encoding: 'utf8',
  });
  assert.equal(archiveCheck.status, 0, archiveCheck.stderr);
  const second = packRelease(config, options);

  assert.deepEqual(readFileSync(resolve(second.outputDirectory, 'release.zip')), firstZip);
  assert.deepEqual(readFileSync(resolve(second.outputDirectory, 'release.json')), firstRelease);
  assert.deepEqual(Object.keys(JSON.parse(firstRelease)), [
    'schemaVersion', 'appId', 'feature', 'releaseId', 'version', 'runtimeVersion', 'archiveSha256', 'archiveBytes',
  ]);
  assert.equal(first.release.appId, 'default');
  assert.equal(existsSync(resolve(first.outputDirectory, 'release-envelope.json')), false);
  assert.equal(existsSync(resolve(first.outputDirectory, 'release-payload.json')), false);
  assert.equal(existsSync(resolve(first.outputDirectory, 'packaging-report.json')), false);

  writeFileSync(resolve(root, 'features/shopping/src/index.tsx'), "export const miniApp = 'shopping-v2';\n");
  const changed = packRelease(config, options);
  assert.notEqual(changed.release.archiveSha256, second.release.archiveSha256);
});
