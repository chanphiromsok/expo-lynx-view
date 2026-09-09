import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = resolve(root, 'bin/lynx.mjs');

test('root help gives the host and mini-app starting commands', () => {
  const result = spawnSync(process.execPath, [cli, '--help'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Mini-app repository: lynx doctor, then lynx release/);
  assert.match(result.stdout, /Expo host repository: lynx keys generate, lynx doctor, lynx host embed\s+<mini-app>, lynx host prepare, then lynx host register\s+--platform\s+<platform>/);
});

test('host embed uses the spaced command and requires only a mini-app path', () => {
  const result = spawnSync(process.execPath, [cli, 'host', 'embed'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /mini-app directory is required/i);
});
