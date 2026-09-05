import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReleaseVersion, releasePackages } from './release.mjs';

test('published packages use one valid release version', () => {
  const packages = releasePackages();
  assert.deepEqual(packages.map(({ manifest }) => manifest.name), ['expo-lynx-view', 'expo-lynx-bundle-cli']);
  assert.equal(new Set(packages.map(({ manifest }) => manifest.version)).size, 1);
  assert.equal(parseReleaseVersion(packages[0].manifest.version), packages[0].manifest.version);
});

test('release version rejects non-semver input', () => {
  assert.throws(() => parseReleaseVersion('v0.3.1'), /semantic version/);
});
