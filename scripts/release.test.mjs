import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReleaseVersion, releasePackages } from './release.mjs';

test('published packages use one valid release version', () => {
  const packages = releasePackages();
  assert.deepEqual(packages.map(({ manifest }) => manifest.name), ['expo-lynx-view', 'expo-lynx-bundle-cli']);
  assert.equal(new Set(packages.map(({ manifest }) => manifest.version)).size, 1);
  assert.equal(parseReleaseVersion(packages[0].manifest.version), packages[0].manifest.version);
});

test('expo-lynx-view publish allow-list excludes the delivery Console', () => {
  const nativePackage = releasePackages().find(({ manifest }) => manifest.name === 'expo-lynx-view');
  assert.ok(nativePackage);
  assert.ok(Array.isArray(nativePackage.manifest.files));
  assert.ok(nativePackage.manifest.files.every((entry) =>
    entry === 'app.plugin.js'
    || entry === 'expo-module.config.json'
    || entry === 'build'
    || entry.startsWith('android/')
    || entry.startsWith('ios/'),
  ));
  assert.equal(nativePackage.manifest.scripts.build, 'EXPO_NONINTERACTIVE=1 expo-module build');
  assert.equal(nativePackage.manifest.scripts.clean, 'expo-module clean');
  assert.equal(nativePackage.manifest.scripts.prepare, 'expo-module prepare');
  assert.equal(nativePackage.manifest.scripts.prepublishOnly, 'expo-module prepublishOnly');
});

test('release version rejects non-semver input', () => {
  assert.throws(() => parseReleaseVersion('v0.3.1'), /semantic version/);
});
