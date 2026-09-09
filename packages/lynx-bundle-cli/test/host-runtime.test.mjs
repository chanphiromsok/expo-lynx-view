import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import { prepareHostRuntime, registerPreparedHostRuntime } from '../src/host-runtime.mjs';

function temporaryHost() {
  const root = mkdtempSync(resolve(tmpdir(), 'lynx-host-runtime-test-'));
  const embedded = resolve(root, 'generated/expo-lynx/embedded/delivery');
  mkdirSync(embedded, { recursive: true });
  writeFileSync(resolve(root, 'app.json'), JSON.stringify({ expo: {
    version: '1.2.0', ios: { buildNumber: '42' }, android: { versionCode: 7 }, plugins: [['expo-lynx-view', {
      embeddedBundlesPath: './generated/expo-lynx/embedded',
      deliveryEndpoints: { delivery: 'https://delivery.example/v1/bs-one/delivery' },
    }]],
  } }));
  writeFileSync(resolve(root, 'generated/expo-lynx/embedded/registry.json'), JSON.stringify({
    schemaVersion: 2,
    features: { delivery: { baseline: 'delivery/baseline.json' } },
    runtimes: {},
  }));
  writeFileSync(resolve(embedded, 'baseline.json'), JSON.stringify({
    schemaVersion: 2,
    feature: 'delivery',
    entry: 'main.lynx.bundle',
    files: [],
  }));
  return root;
}

test('prepares then registers the exact runtime held by the embedded registry', async () => {
  const root = temporaryHost();
  const prepared = await prepareHostRuntime({ cwd: root, runtimeFactory: async () => 'runtime-a' });
  assert.equal(prepared.runtimeVersion, 'runtime-a');
  assert.deepEqual(JSON.parse(readFileSync(resolve(root, 'generated/expo-lynx/embedded/registry.json'))).runtimes.ios, {
    runtimeVersion: 'runtime-a', appVersion: '1.2.0', buildNumber: '42',
  });
  let request;
  const registered = await registerPreparedHostRuntime({
    cwd: root,
    apiKey: 'lynx_live_test',
    runtimeFactory: async () => 'runtime-a',
    fetchImpl: async (url, init) => {
      request = { url, init };
      return Response.json({ ok: true });
    },
  });
  assert.equal(registered.appId, 'bs-one');
  assert.equal(request.url, 'https://delivery.example/api/apps/bs-one/runtime');
  assert.deepEqual(JSON.parse(request.init.body), {
    schemaVersion: 1, platform: 'ios', runtimeVersion: 'runtime-a', appVersion: '1.2.0', buildNumber: '42', features: ['delivery'],
  });
});

test('prepares Android with its own native build number', async () => {
  const root = temporaryHost();
  const result = await prepareHostRuntime({ cwd: root, platform: 'android', runtimeFactory: async () => 'android-runtime-a' });
  assert.equal(result.buildNumber, '7');
  assert.equal(result.runtimeVersion, 'android-runtime-a');
  assert.deepEqual(JSON.parse(readFileSync(resolve(root, 'generated/expo-lynx/embedded/registry.json'))).runtimes.android, {
    runtimeVersion: 'android-runtime-a', appVersion: '1.2.0', buildNumber: '7',
  });
  let request;
  await registerPreparedHostRuntime({
    cwd: root,
    platform: 'android',
    apiKey: 'lynx_live_test',
    runtimeFactory: async () => 'android-runtime-a',
    fetchImpl: async (_url, init) => {
      request = init;
      return Response.json({ ok: true });
    },
  });
  assert.deepEqual(JSON.parse(request.body), {
    schemaVersion: 1, platform: 'android', runtimeVersion: 'android-runtime-a', appVersion: '1.2.0', buildNumber: '7', features: ['delivery'],
  });
});

test('refuses to register a host project changed since preparation', async () => {
  const root = temporaryHost();
  await prepareHostRuntime({ cwd: root, runtimeFactory: async () => 'runtime-a' });
  await assert.rejects(
    registerPreparedHostRuntime({ cwd: root, apiKey: 'lynx_live_test', runtimeFactory: async () => 'runtime-b' }),
    /changed after lynx host prepare/,
  );
});
