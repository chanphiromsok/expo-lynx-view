import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lynxSourceRoot = resolve(process.env.LYNX_SOURCE_DIR ?? resolve(repositoryRoot, '..', 'lynx-source'));
const exampleRoot = resolve(repositoryRoot, 'apps', 'expo-lynx-example');
const sourceBundle = resolve(lynxSourceRoot, 'dist', 'main.lynx.bundle');
const sourceAssets = resolve(lynxSourceRoot, 'dist', 'static');
const skipBuild = process.argv.slice(2).includes('--skip-build');

if (process.argv.slice(2).some((argument) => argument !== '--skip-build')) {
  throw new Error('Usage: pnpm sync:example-bundle [--skip-build]');
}

if (!existsSync(lynxSourceRoot)) {
  throw new Error(
    `Lynx source directory was not found: ${lynxSourceRoot}\n` +
      'Set LYNX_SOURCE_DIR to the directory that contains its package.json.'
  );
}

function buildCommand(sourceRoot) {
  if (existsSync(resolve(sourceRoot, 'package-lock.json'))) {
    return ['npm', ['run', 'build']];
  }

  if (existsSync(resolve(sourceRoot, 'pnpm-lock.yaml'))) {
    return ['pnpm', ['run', 'build']];
  }

  if (existsSync(resolve(sourceRoot, 'yarn.lock'))) {
    return ['yarn', ['build']];
  }

  throw new Error(`No supported lockfile found in ${sourceRoot}.`);
}

function runBuild() {
  const [command, args] = buildCommand(lynxSourceRoot);
  console.log(`Building Lynx bundle: ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: lynxSourceRoot,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Lynx bundle build failed with exit code ${result.status}.`);
  }
}

function copyFile(source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { force: true });
  console.log(`Synced ${destination.slice(repositoryRoot.length + 1)}`);
}

function copyDirectory(source, destination) {
  if (!existsSync(source)) {
    return;
  }

  cpSync(source, destination, { recursive: true, force: true });
  console.log(`Synced ${destination.slice(repositoryRoot.length + 1)}/`);
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

if (!skipBuild) {
  runBuild();
}

if (!existsSync(sourceBundle) || !statSync(sourceBundle).isFile()) {
  throw new Error(`Lynx bundle was not generated: ${sourceBundle}`);
}

const bundleTargets = [
  resolve(exampleRoot, 'assets', 'static.lynx'),
  resolve(exampleRoot, 'ios', 'expolynxexample', 'static.lynx'),
  resolve(exampleRoot, 'android', 'app', 'src', 'main', 'assets', 'static.lynx'),
];

const assetTargets = [
  resolve(exampleRoot, 'assets', 'static'),
  resolve(exampleRoot, 'ios', 'expolynxexample', 'static'),
  resolve(exampleRoot, 'android', 'app', 'src', 'main', 'assets', 'static'),
];

for (const target of bundleTargets) {
  copyFile(sourceBundle, target);
}

for (const target of assetTargets) {
  copyDirectory(sourceAssets, target);
}

const expectedHash = sha256(sourceBundle);
for (const target of bundleTargets) {
  if (sha256(target) !== expectedHash) {
    throw new Error(`Checksum mismatch after syncing ${target}`);
  }
}

console.log(`Bundle synchronized successfully (${expectedHash}).`);
