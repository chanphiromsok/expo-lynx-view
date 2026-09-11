import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  buildEmbedded,
  captureGitProvenance,
  checkEmbedded,
  loadConfigAsync,
  loadMiniAppConfigAsync,
  packRelease,
  readEmbeddedRuntimeVersion,
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

  const built = buildEmbedded(config, []);
  assert.deepEqual(Object.keys(built.registry.features), ['orders', 'shopping']);
  assert.deepEqual(checkEmbedded(config).features, built.registry.features);
  built.registry.runtimes.ios = { runtimeVersion: 'ios:expo-57', appVersion: '1.0.0', buildNumber: '1' };
  writeFileSync(resolve(root, 'generated/expo-lynx/embedded/registry.json'), JSON.stringify(built.registry));
  assert.equal(readEmbeddedRuntimeVersion(config), 'ios:expo-57');
  assert.equal(
    readFileSync(resolve(root, 'generated/expo-lynx/embedded/shopping/main.lynx.bundle'), 'utf8').includes('shopping'),
    true
  );

  writeFileSync(resolve(root, 'generated/expo-lynx/embedded/shopping/main.lynx.bundle'), 'changed');
  assert.throws(() => checkEmbedded(config), /stale/);
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

test('loads flat host feature IDs without mini-app release settings', async () => {
  const { root } = await temporaryApp();
  const configPath = resolve(root, 'flat-lynx-bundle.config.mjs');
  writeFileSync(
    configPath,
    "export default { featuresDir: './features', features: ['shopping'], embeddedOutputDir: './generated/expo-lynx/embedded' };\n"
  );
  const config = await loadConfigAsync({ configPath });
  assert.deepEqual(Object.keys(config.features), ['shopping']);
  assert.equal(config.features.shopping.entry, resolve(root, 'features/shopping/src/index.tsx'));
});

test('loads the intentionally small independent mini-app config', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'lynx-mini-app-cli-test-'));
  const sourcePath = resolve(dirname(fileURLToPath(import.meta.url)), '../src/index.mjs').replaceAll('\\', '\\\\');
  writeFileSync(resolve(root, 'lynx-miniapp.config.ts'), `import { defineMiniApp } from '${sourcePath}';\nexport default defineMiniApp({ appId: 'bs-one', feature: 'merchant-home' });\n`);
  const config = await loadMiniAppConfigAsync({ cwd: root });
  assert.equal(config.appId, 'bs-one');
  assert.equal(config.feature, 'merchant-home');
  assert.equal(config.features['merchant-home'].entry, resolve(root, 'src/index.tsx'));
});

test('rejects a feature-directory symlink that resolves outside the consuming repository', async () => {
  const { root, config } = await temporaryApp();
  const externalRoot = mkdtempSync(resolve(tmpdir(), 'lynx-bundle-cli-external-'));
  const originalFeatures = resolve(root, 'features');
  renameSync(originalFeatures, resolve(externalRoot, 'features'));
  symlinkSync(resolve(externalRoot, 'features'), originalFeatures, 'dir');
  assert.throws(() => buildEmbedded(config, []), /resolves outside/);
});

test('produces deterministic ZIP bytes and the minimal unsigned release metadata', async () => {
  const { root, config } = await temporaryApp();
  const options = {
    featureId: 'shopping',
    releaseId: 'shopping-2026.08.29.1',
    version: '2026.08.29.1',
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
    'schemaVersion', 'appId', 'feature', 'releaseId', 'version', 'archiveSha256', 'archiveBytes',
  ]);
  assert.equal(first.release.appId, 'default');
  assert.equal(existsSync(resolve(first.outputDirectory, 'release-envelope.json')), false);
  assert.equal(existsSync(resolve(first.outputDirectory, 'release-payload.json')), false);
  assert.equal(existsSync(resolve(first.outputDirectory, 'packaging-report.json')), false);

  writeFileSync(resolve(root, 'features/shopping/src/index.tsx'), "export const miniApp = 'shopping-v2';\n");
  const changed = packRelease(config, options);
  assert.notEqual(changed.release.archiveSha256, second.release.archiveSha256);
});

test('captureGitProvenance omits git entirely outside a work tree', () => {
  const outside = mkdtempSync(resolve(tmpdir(), 'lynx-no-git-'));
  assert.equal(captureGitProvenance(outside), undefined);
});

test('captureGitProvenance reports commit, branch, subject, and a dirty working tree', () => {
  const repo = mkdtempSync(resolve(tmpdir(), 'lynx-git-provenance-'));
  const git = (args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  git(['init']);
  git(['checkout', '-b', 'feat/example']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  writeFileSync(resolve(repo, 'a.txt'), 'hello\n');
  git(['add', '.']);
  git(['commit', '-m', 'feat: add a.txt']);

  const clean = captureGitProvenance(repo);
  assert.equal(clean.branch, 'feat/example');
  assert.equal(clean.subject, 'feat: add a.txt');
  assert.match(clean.commit, /^[0-9a-f]{40}$/);
  assert.equal(clean.dirty, false);

  writeFileSync(resolve(repo, 'a.txt'), 'changed\n');
  const dirty = captureGitProvenance(repo);
  assert.equal(dirty.commit, clean.commit);
  assert.equal(dirty.dirty, true);
});

test('packRelease embeds git provenance in release.json when built from a work tree', async () => {
  const { root, config } = await temporaryApp();
  const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  git(['init']);
  git(['checkout', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  // Mirror this monorepo's own .gitignore so packRelease's build cache and
  // packed output don't make the fixture spuriously "dirty".
  writeFileSync(resolve(root, '.gitignore'), 'node_modules/\ndist/\n');
  git(['add', '.']);
  git(['commit', '-m', 'chore: initial fixture']);

  const packed = packRelease(config, {
    featureId: 'shopping',
    releaseId: 'shopping-2026.08.29.3',
    version: '2026.08.29.3',
  });
  assert.equal(packed.release.schemaVersion, 4);
  assert.equal(packed.release.git.branch, 'main');
  assert.equal(packed.release.git.subject, 'chore: initial fixture');
  assert.equal(packed.release.git.dirty, false);
  assert.match(packed.release.git.commit, /^[0-9a-f]{40}$/);
});
