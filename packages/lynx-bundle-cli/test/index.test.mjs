import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  buildEmbedded,
  checkEmbedded,
  generateKeys,
  loadConfigAsync,
  packRelease,
  signPayloadFile,
  verifyEnvelope,
} from '../src/index.mjs';

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/app');
const protocolFixtureRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../expo-lynx/feature/delivery-bundle-update/fixtures/v2'
);

async function temporaryApp() {
  const root = mkdtempSync(resolve(tmpdir(), 'lynx-bundle-cli-test-'));
  cpSync(fixtureRoot, root, { recursive: true });
  const config = await loadConfigAsync({ configPath: resolve(root, 'lynx-bundle.config.mjs') });
  const keys = generateKeys(resolve(root, 'keys'));
  return { root, config, keys };
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
    `import { defineConfig } from '${sourcePath}';\nexport default defineConfig({ featuresDir: './features', features: { shopping: {} }, embeddedOutputDir: './generated/expo-lynx/embedded', signing: { privateKeyPath: './keys/updates.private.pem' } });\n`
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

test('produces deterministic ZIP, payload, and RSA-SHA256 envelope bytes', async () => {
  const { root, config, keys } = await temporaryApp();
  const options = {
    featureId: 'shopping',
    releaseId: 'shopping-2026.08.29.1',
    version: '2026.08.29.1',
    platform: 'ios',
    runtimeVersion: 'expo-57',
  };
  const first = packRelease(config, options);
  const firstZip = readFileSync(resolve(first.outputDirectory, 'release.zip'));
  const firstPayload = readFileSync(resolve(first.outputDirectory, 'release-payload.json'));
  const firstEnvelope = readFileSync(resolve(first.outputDirectory, 'release-envelope.json'));
  const archiveCheck = spawnSync('unzip', ['-t', resolve(first.outputDirectory, 'release.zip')], {
    encoding: 'utf8',
  });
  assert.equal(archiveCheck.status, 0, archiveCheck.stderr);
  const second = packRelease(config, options);

  assert.deepEqual(readFileSync(resolve(second.outputDirectory, 'release.zip')), firstZip);
  assert.deepEqual(readFileSync(resolve(second.outputDirectory, 'release-payload.json')), firstPayload);
  assert.deepEqual(readFileSync(resolve(second.outputDirectory, 'release-envelope.json')), firstEnvelope);
  assert.equal(verifyEnvelope(second.envelope, keys.publicKeyPath), true);
  assert.equal(verifyEnvelope({ ...second.envelope, signature: `${second.envelope.signature.slice(0, -1)}A` }, keys.publicKeyPath), false);

  writeFileSync(resolve(root, 'features/shopping/src/index.tsx'), "export const miniApp = 'shopping-v2';\n");
  const changed = packRelease(config, options);
  assert.notEqual(changed.report.archiveSha256, second.report.archiveSha256);
  assert.notEqual(changed.report.payloadSha256, second.report.payloadSha256);
});

test('generates owner-only PKCS#8 private keys and refuses wrong signing payload types', async () => {
  const { root, config, keys } = await temporaryApp();
  assert.equal(statSync(keys.privateKeyPath).mode & 0o777, 0o600);
  assert.match(readFileSync(keys.publicKeyPath, 'utf8'), /BEGIN PUBLIC KEY/);
  assert.throws(() => generateKeys(resolve(root, 'keys')), /Refusing to overwrite/);

  const release = packRelease(config, {
    featureId: 'orders',
    releaseId: 'orders-2026.08.29.1',
    version: '2026.08.29.1',
    platform: 'ios',
    runtimeVersion: 'expo-57',
  });
  const payloadPath = resolve(release.outputDirectory, 'release-payload.json');
  assert.equal(verifyEnvelope(signPayloadFile(config, payloadPath, 'lynx-release'), keys.publicKeyPath), true);
  writeFileSync(payloadPath, '{"type":"lynx-channel","feature":"orders"}\n');
  assert.throws(() => signPayloadFile(config, payloadPath, 'lynx-release'), /Payload type/);
});

test('verifies the checked-in M02 Swift/Worker cryptographic fixture envelopes', () => {
  const publicKeyPath = resolve(protocolFixtureRoot, 'crypto-development/updates.public.pem');
  for (const type of ['channel', 'release']) {
    const envelope = JSON.parse(
      readFileSync(resolve(protocolFixtureRoot, `crypto-development/valid-${type}-envelope.json`), 'utf8')
    );
    const payload = readFileSync(resolve(protocolFixtureRoot, `valid-${type}-payload.json`));
    assert.deepEqual(Buffer.from(envelope.payload, 'base64url'), payload);
    assert.equal(verifyEnvelope(envelope, publicKeyPath), true);
    assert.equal(verifyEnvelope({ ...envelope, payload: `${envelope.payload.slice(0, -1)}A` }, publicKeyPath), false);
  }
});
