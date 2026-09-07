import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import { loadExpoConfig } from '../src/expo-config.mjs';

test('resolves an app.config.ts without evaluating config plugins', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'lynx-expo-config-test-'));
  writeFileSync(resolve(root, 'app.config.ts'), 'export default {};\n');
  const config = loadExpoConfig(root, (_root, options) => {
    assert.deepEqual(options, { skipSDKVersionRequirement: true, isPublicConfig: true, skipPlugins: true });
    return { exp: { version: '1.0.0' } };
  });
  assert.equal(config.version, '1.0.0');
});

test('retains dynamic expo plugin options before config plugins run', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'lynx-expo-dynamic-config-test-'));
  writeFileSync(resolve(root, 'app.config.ts'), 'export default {}\n');
  const config = loadExpoConfig(
    root,
    () => ({ exp: { version: '1.0.0' } }),
    (_path, request) => {
      assert.equal(request.projectRoot, root);
      return { config: { plugins: [['expo-lynx-view', { publicKeyPath: './keys/updates.public.pem' }]] } };
    },
  );
  assert.deepEqual(config.plugins, [['expo-lynx-view', { publicKeyPath: './keys/updates.public.pem' }]]);
});
