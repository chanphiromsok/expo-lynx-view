import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import { inspectDeliveryWorkspace } from '../src/doctor.mjs';

test('doctor identifies an independent mini app without mutating it', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'lynx-doctor-test-'));
  writeFileSync(resolve(root, 'lynx-miniapp.config.mjs'), "export default { appId: 'bs-one', feature: 'merchant-home' };\n");
  const originalServer = process.env.LYNX_DELIVERY_SERVER;
  const originalKey = process.env.LYNX_DELIVERY_API_KEY;
  process.env.LYNX_DELIVERY_SERVER = 'https://delivery.example';
  process.env.LYNX_DELIVERY_API_KEY = 'lynx_live_test';
  try {
    const result = await inspectDeliveryWorkspace({ cwd: root });
    assert.equal(result.ok, true);
    assert.deepEqual(result.checks[0], { name: 'mini-app-config', ok: true, detail: 'bs-one/merchant-home' });
  } finally {
    if (originalServer === undefined) delete process.env.LYNX_DELIVERY_SERVER; else process.env.LYNX_DELIVERY_SERVER = originalServer;
    if (originalKey === undefined) delete process.env.LYNX_DELIVERY_API_KEY; else process.env.LYNX_DELIVERY_API_KEY = originalKey;
  }
});

test('doctor names missing host trust-key and build metadata', async () => {
  const root = mkdtempSync(resolve(tmpdir(), 'lynx-doctor-host-test-'));
  writeFileSync(resolve(root, 'app.json'), JSON.stringify({ expo: {
    version: '1.0.0',
    plugins: [['expo-lynx-view', { deliveryEndpoints: { 'merchant-home': 'https://delivery.example/v1/bs-one/merchant-home' } }]],
  } }));
  const result = await inspectDeliveryWorkspace({ cwd: root });
  assert.deepEqual(result.checks.slice(0, 3), [
    { name: 'host-config', ok: true, detail: 'expo-lynx-view delivery endpoints found' },
    { name: 'public-key', ok: false, detail: 'Configure expo-lynx-view publicKeyPath, then run lynx keys generate.' },
    { name: 'host-build', ok: false, detail: 'Set expo.version and expo.ios.buildNumber before lynx host prepare --platform ios.' },
  ]);
});
