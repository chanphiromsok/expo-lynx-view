import assert from 'node:assert/strict';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = resolve(packageRoot, 'test/fixtures/app');
const legacyCli = resolve(packageRoot, 'bin/lynx-bundle.mjs');
const cli = resolve(packageRoot, 'bin/lynx.mjs');

function run(command, root, argumentsList, env = process.env) {
  return spawnSync(process.execPath, [command, ...argumentsList], { cwd: root, encoding: 'utf8', env });
}

test('the public CLI packages one cross-platform release', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'lynx-bundle-cli-command-'));
  cpSync(fixtureRoot, root, { recursive: true });
  const packResult = run(legacyCli, root, [
    'pack',
    'shopping',
    '--release-id',
    'shopping-2026.08.29.1',
    '--version',
    '2026.08.29.1',
  ]);
  assert.equal(packResult.status, 0, packResult.stderr);
  assert.equal(readFileSync(resolve(root, 'dist/lynx-releases/shopping/shopping-2026.08.29.1/release.zip')).subarray(0, 4).toString('hex'), '504b0304');
  const secondResult = run(legacyCli, root, [
    'pack',
    'shopping',
    '--release-id',
    'shopping-2026.08.29.2',
    '--version',
    '2026.08.29.2',
  ]);
  assert.equal(secondResult.status, 0, secondResult.stderr);
  const secondRelease = JSON.parse(readFileSync(resolve(root, 'dist/lynx-releases/shopping/shopping-2026.08.29.2/release.json'), 'utf8'));
  assert.equal(secondRelease.schemaVersion, 4);
  assert.equal('platform' in secondRelease, false);
});

test('lynx release builds a draft from an independent mini-app repository', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'lynx-release-command-'));
  const fakeBin = resolve(root, 'bin');
  mkdirSync(resolve(root, 'src'), { recursive: true });
  mkdirSync(fakeBin);
  writeFileSync(resolve(root, 'lynx-miniapp.config.mjs'), "export default { appId: 'bs-one', feature: 'mart' };\n");
  writeFileSync(resolve(root, 'lynx.config.ts'), 'export default {};\n');
  writeFileSync(resolve(root, 'src/index.tsx'), 'export default null;\n');
  writeFileSync(resolve(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  const fakePnpm = resolve(fakeBin, 'pnpm');
  writeFileSync(fakePnpm, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
const output = process.env.LYNX_BUNDLE_OUTPUT_DIR;
mkdirSync(output, { recursive: true });
writeFileSync(output + '/main.lynx.bundle', 'bundle');
`);
  chmodSync(fakePnpm, 0o755);

  const result = run(cli, root, [
    'release', '--draft', '--release-id', 'mart-test', '--version', '1.0.0',
  ], { ...process.env, PATH: `${fakeBin}${delimiter}${process.env.PATH}` });
  assert.equal(result.status, 0, result.stderr);
  const release = JSON.parse(readFileSync(resolve(root, 'dist/lynx-releases/mart-test/release.json'), 'utf8'));
  assert.deepEqual(
    { schemaVersion: release.schemaVersion, appId: release.appId, feature: release.feature, platform: release.platform },
    { schemaVersion: 4, appId: 'bs-one', feature: 'mart', platform: undefined },
  );
});
