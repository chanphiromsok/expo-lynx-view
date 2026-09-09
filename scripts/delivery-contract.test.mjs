import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { embedMiniApp } from '../packages/lynx-bundle-cli/src/host-embed.mjs';
import { prepareHostRuntime, registerPreparedHostRuntime } from '../packages/lynx-bundle-cli/src/host-runtime.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { _internal: plugin } = createRequire(import.meta.url)(resolve(repositoryRoot, 'packages/expo-lynx/app.plugin.js'));

test('CLI output remains compatible with mobile packaging and Worker registration', async (t) => {
  const root = mkdtempSync(resolve(tmpdir(), 'lynx-delivery-contract-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const embedded = resolve(root, 'generated/expo-lynx/embedded');
  const miniApp = resolve(root, 'mart');
  const buildOutput = resolve(root, 'build-output');
  const publicKey = resolve(root, 'keys/updates.public.pem');
  mkdirSync(resolve(miniApp, 'src'), { recursive: true });
  mkdirSync(buildOutput, { recursive: true });
  mkdirSync(dirname(publicKey), { recursive: true });
  writeFileSync(resolve(root, 'app.json'), JSON.stringify({ expo: {
    version: '1.0.0',
    ios: { buildNumber: '30' },
    android: { versionCode: 30 },
    plugins: [['expo-lynx-view', {
      embeddedBundlesPath: './generated/expo-lynx/embedded',
      publicKeyPath: './keys/updates.public.pem',
      deliveryEndpoints: { mart: 'https://delivery.example/v1/bs-one/mart' },
    }]],
  } }));
  writeFileSync(resolve(miniApp, 'lynx-miniapp.config.mjs'), "export default { appId: 'bs-one', feature: 'mart' };\n");
  writeFileSync(resolve(miniApp, 'src/index.tsx'), 'export default null;\n');
  writeFileSync(resolve(miniApp, 'lynx.config.ts'), 'export default {};\n');
  writeFileSync(resolve(buildOutput, 'main.lynx.bundle'), 'bundle');
  copyFileSync(
    resolve(repositoryRoot, 'packages/expo-lynx/feature/delivery-bundle-update/fixtures/v2/crypto-development/updates.public.pem'),
    publicKey,
  );

  await embedMiniApp({
    cwd: root,
    miniAppDirectory: './mart',
    buildFactory: () => ({
      outputDirectory: buildOutput,
      files: [{
        path: 'main.lynx.bundle',
        bytes: 6,
        sha256: createHash('sha256').update('bundle').digest('hex'),
        absolutePath: resolve(buildOutput, 'main.lynx.bundle'),
      }],
    }),
  });
  for (const platform of ['ios', 'android']) {
    await prepareHostRuntime({ cwd: root, platform, runtimeFactory: async () => `${platform}:runtime` });
  }

  const registry = JSON.parse(readFileSync(resolve(embedded, 'registry.json'), 'utf8'));
  const baseline = JSON.parse(readFileSync(resolve(embedded, 'mart/baseline.json'), 'utf8'));
  assert.equal(registry.schemaVersion, 2);
  assert.equal(baseline.schemaVersion, 2);
  assert.deepEqual(registry.features, { mart: { baseline: 'mart/baseline.json' } });
  assert.equal(registry.runtimes.ios.runtimeVersion, 'ios:runtime');
  assert.equal(registry.runtimes.android.runtimeVersion, 'android:runtime');
  assert.deepEqual(Object.keys(baseline), ['schemaVersion', 'feature', 'entry', 'files']);
  assert.equal(existsSync(resolve(embedded, 'ios')), false);
  assert.equal(existsSync(resolve(embedded, 'android')), false);

  const options = {
    embeddedBundlesPath: './generated/expo-lynx/embedded',
    publicKeyPath: './keys/updates.public.pem',
    deliveryEndpoints: { mart: 'https://delivery.example/v1/bs-one/mart' },
  };
  const infoPlist = plugin.applyV2InfoPlist({}, root, options);
  assert.equal(infoPlist[plugin.INFO_PLIST_RUNTIME_VERSION], 'ios:runtime');
  const android = plugin.materializeV2AndroidResources({ projectRoot: root, options });
  assert.equal(JSON.parse(readFileSync(android.configurationPath, 'utf8')).runtimeVersion, 'android:runtime');

  const requests = [];
  for (const platform of ['ios', 'android']) {
    await registerPreparedHostRuntime({
      cwd: root,
      platform,
      apiKey: 'lynx_live_contract_test',
      runtimeFactory: async () => `${platform}:runtime`,
      fetchImpl: async (url, init) => {
        requests.push({ url, body: JSON.parse(init.body) });
        return Response.json({ ok: true });
      },
    });
  }
  assert.deepEqual(requests.map(({ url }) => url), [
    'https://delivery.example/api/apps/bs-one/runtime',
    'https://delivery.example/api/apps/bs-one/runtime',
  ]);
  assert.deepEqual(requests.map(({ body }) => body), [
    { schemaVersion: 1, platform: 'ios', runtimeVersion: 'ios:runtime', appVersion: '1.0.0', buildNumber: '30', features: ['mart'] },
    { schemaVersion: 1, platform: 'android', runtimeVersion: 'android:runtime', appVersion: '1.0.0', buildNumber: '30', features: ['mart'] },
  ]);
});
