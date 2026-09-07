import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = resolve(packageRoot, 'test/fixtures/app');
const cli = resolve(packageRoot, 'bin/lynx-bundle.mjs');

function run(root, argumentsList) {
  return spawnSync(process.execPath, [cli, ...argumentsList], { cwd: root, encoding: 'utf8' });
}

test('the public CLI packages platform-scoped releases', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'lynx-bundle-cli-command-'));
  cpSync(fixtureRoot, root, { recursive: true });
  const packResult = run(root, [
    'pack',
    'shopping',
    '--release-id',
    'shopping-2026.08.29.1',
    '--version',
    '2026.08.29.1',
    '--platform',
    'ios',
    '--runtime-version',
    'expo-57',
  ]);
  assert.equal(packResult.status, 0, packResult.stderr);
  assert.equal(readFileSync(resolve(root, 'dist/lynx-releases/shopping/shopping-2026.08.29.1/release.zip')).subarray(0, 4).toString('hex'), '504b0304');
  const androidResult = run(root, [
    'pack',
    'shopping',
    '--release-id',
    'shopping-2026.08.29.2',
    '--version',
    '2026.08.29.2',
    '--platform',
    'android',
    '--runtime-version',
    'expo-57',
  ]);
  assert.equal(androidResult.status, 0, androidResult.stderr);
  const androidRelease = JSON.parse(readFileSync(resolve(root, 'dist/lynx-releases/shopping/shopping-2026.08.29.2/release.json'), 'utf8'));
  assert.equal(androidRelease.platform, 'android');
});
