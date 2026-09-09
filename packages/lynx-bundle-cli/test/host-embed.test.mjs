import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import { embedMiniApp } from '../src/host-embed.mjs';

test('builds an independent mini app into the host embedded fallback tree', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'lynx-host-embed-test-'));
  const mini = resolve(root, 'mart');
  const output = resolve(root, 'build-output');
  mkdirSync(resolve(mini, 'src'), { recursive: true });
  mkdirSync(resolve(output, 'static'), { recursive: true });
  writeFileSync(resolve(root, 'app.json'), JSON.stringify({ expo: {
    version: '1.0.0', ios: { buildNumber: '1' }, android: { versionCode: 1 }, plugins: [['expo-lynx-view', {
      embeddedBundlesPath: './generated/expo-lynx/embedded',
      deliveryEndpoints: { 'merchant-home': 'https://delivery.example/v1/bs-one/merchant-home' },
    }]],
  } }));
  writeFileSync(resolve(mini, 'lynx-miniapp.config.mjs'), "export default { appId: 'bs-one', feature: 'merchant-home' };\n");
  writeFileSync(resolve(mini, 'src/index.tsx'), 'export default null;\n');
  writeFileSync(resolve(mini, 'lynx.config.ts'), 'export default {};\n');
  writeFileSync(resolve(output, 'main.lynx.bundle'), 'bundle');
  writeFileSync(resolve(output, 'static/logo.png'), 'logo');

  const result = await embedMiniApp({
    cwd: root,
    miniAppDirectory: './mart',
    buildFactory: (config, feature) => ({
      outputDirectory: output,
      files: [
        { path: 'main.lynx.bundle', bytes: 6, sha256: 'a'.repeat(64), absolutePath: resolve(output, 'main.lynx.bundle') },
        { path: 'static/logo.png', bytes: 4, sha256: 'b'.repeat(64), absolutePath: resolve(output, 'static/logo.png') },
      ],
      config,
      feature,
    }),
  });

  const embedded = resolve(root, 'generated/expo-lynx/embedded');
  assert.deepEqual(result, {
    appId: 'bs-one', feature: 'merchant-home', embeddedRoot: embedded,
  });
  assert.equal(readFileSync(resolve(embedded, 'merchant-home/main.lynx.bundle'), 'utf8'), 'bundle');
  assert.deepEqual(JSON.parse(readFileSync(resolve(embedded, 'registry.json'), 'utf8')), {
    schemaVersion: 2,
    features: { 'merchant-home': { baseline: 'merchant-home/baseline.json' } },
    runtimes: {},
  });
  assert.deepEqual(JSON.parse(readFileSync(resolve(embedded, 'merchant-home/baseline.json'), 'utf8')), {
    schemaVersion: 2,
    feature: 'merchant-home',
    entry: 'main.lynx.bundle',
    files: [
      { path: 'main.lynx.bundle', bytes: 6, sha256: 'a'.repeat(64) },
      { path: 'static/logo.png', bytes: 4, sha256: 'b'.repeat(64) },
    ],
  });
  assert.equal(existsSync(output), false);
});
