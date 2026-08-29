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

test('the public CLI creates keys, packages an iOS release, and rejects Android packaging', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'lynx-bundle-cli-command-'));
  cpSync(fixtureRoot, root, { recursive: true });
  const keyResult = run(root, ['keys', 'generate', '--output-dir', './keys']);
  assert.equal(keyResult.status, 0, keyResult.stderr);
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
  assert.notEqual(androidResult.status, 0);
  assert.match(androidResult.stderr, /iOS release packaging only/);
});
