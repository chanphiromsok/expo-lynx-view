import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageDirectories = ['packages/expo-lynx', 'packages/lynx-bundle-cli'];
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function parseReleaseVersion(value) {
  if (!semver.test(value ?? '')) {
    throw new Error('Version must be a semantic version such as 0.3.1 or 0.3.1-beta.1.');
  }
  return value;
}

export function releasePackages() {
  return packageDirectories.map((directory) => {
    const packagePath = resolve(repositoryRoot, directory, 'package.json');
    return { directory: resolve(repositoryRoot, directory), packagePath, manifest: readJson(packagePath) };
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed.`);
}

function prepare(version) {
  const nextVersion = parseReleaseVersion(version);
  for (const item of releasePackages()) {
    item.manifest.version = nextVersion;
    writeJson(item.packagePath, item.manifest);
    console.log(`${item.manifest.name} -> ${nextVersion}`);
  }
  console.log('\nReview the two package.json files, commit them, then run pnpm release:check.');
}

function assertOneVersion() {
  const packages = releasePackages();
  const versions = new Set(packages.map(({ manifest }) => manifest.version));
  if (versions.size !== 1) {
    throw new Error(`Published packages must share one version: ${packages.map(({ manifest }) => `${manifest.name}@${manifest.version}`).join(', ')}`);
  }
  const [version] = versions;
  parseReleaseVersion(version);
  return packages;
}

function check() {
  const packages = assertOneVersion();
  run('pnpm', ['lint']);
  run('pnpm', ['test']);
  run('pnpm', ['build']);
  for (const item of packages) run('npm', ['pack', '--dry-run'], { cwd: item.directory });
  console.log(`\nReady to publish ${packages.map(({ manifest }) => `${manifest.name}@${manifest.version}`).join(' and ')}.`);
}

function assertCleanWorkingTree() {
  const result = spawnSync('git', ['status', '--porcelain'], { cwd: repositoryRoot, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Could not inspect the Git working tree.');
  if (result.stdout.trim()) {
    throw new Error('Commit or stash all changes before publishing. pnpm release:check is safe to run with local changes.');
  }
}

function assertVersionsAreAvailable(packages) {
  for (const { manifest } of packages) {
    const target = `${manifest.name}@${manifest.version}`;
    const result = spawnSync('npm', ['view', target, 'version', '--json'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    });
    if (result.status === 0) throw new Error(`${target} is already published on npm.`);
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    if (result.status !== 1 || !/\b404\b/.test(output)) {
      throw new Error(`Could not verify whether ${target} is available on npm.`);
    }
  }
}

function publish(argumentsList) {
  const [flag] = argumentsList;
  if (argumentsList.length > 1 || (flag && flag !== '--dry-run')) {
    throw new Error('Usage: pnpm release:publish [--dry-run]');
  }
  if (flag === '--dry-run') return check();

  const packages = assertOneVersion();
  assertCleanWorkingTree();
  assertVersionsAreAvailable(packages);
  check();
  for (const item of packages) run('npm', ['publish'], { cwd: item.directory });
}

function main(argumentsList) {
  const [command, ...rest] = argumentsList;
  if (command === 'prepare' && rest.length === 1) return prepare(rest[0]);
  if (command === 'check' && rest.length === 0) return check();
  if (command === 'publish') return publish(rest);
  throw new Error('Usage: pnpm release:prepare <version> | pnpm release:check | pnpm release:publish [--dry-run]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`Release failed: ${error.message}`);
    process.exitCode = 1;
  }
}
