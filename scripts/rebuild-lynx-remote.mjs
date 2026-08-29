import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sourceRoot = resolve(
  process.env.LYNX_SOURCE_DIR ?? resolve(repositoryRoot, '..', 'lynx-source')
);
const bundlePath = resolve(sourceRoot, 'dist', 'main.lynx.bundle');

if (!existsSync(sourceRoot)) {
  throw new Error(
    `Lynx source directory was not found: ${sourceRoot}\n` +
      'Set LYNX_SOURCE_DIR to the directory that contains its package.json.'
  );
}

console.log(`Building remote Lynx source in ${sourceRoot}`);
const build = spawnSync('npm', ['run', 'build'], {
  cwd: sourceRoot,
  stdio: 'inherit',
});

if (build.error) {
  throw build.error;
}
if (build.status !== 0) {
  throw new Error(`Lynx source build failed with exit code ${build.status}.`);
}
if (!existsSync(bundlePath)) {
  throw new Error(`The Lynx build did not produce ${bundlePath}.`);
}

const distArgument = resolve(sourceRoot, 'dist');
const prepare = spawnSync(
  process.execPath,
  [
    resolve(repositoryRoot, 'scripts', 'serve-local-lynx-release.mjs'),
    '--dist',
    distArgument,
    '--prepare-only',
  ],
  {
    cwd: repositoryRoot,
    stdio: 'inherit',
  }
);

if (prepare.error) {
  throw prepare.error;
}
if (prepare.status !== 0) {
  throw new Error(`The remote release preparation failed with exit code ${prepare.status}.`);
}

console.log('Remote server files refreshed. Reload the managed mini-app to fetch the new release.');
