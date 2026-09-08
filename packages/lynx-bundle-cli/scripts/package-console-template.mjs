import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageRoot, '../..');
const consoleRoot = resolve(repositoryRoot, 'apps/console');
const templateRoot = resolve(packageRoot, 'template');
const packageRequire = createRequire(resolve(packageRoot, 'package.json'));

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed.`);
}

if (!existsSync(consoleRoot)) throw new Error('The Console source is required to package the CLI template.');
rmSync(templateRoot, { recursive: true, force: true });
mkdirSync(templateRoot, { recursive: true });
run('pnpm', ['--filter', '@expo-lynx/delivery-console', 'build'], repositoryRoot);
run(packageRequire.resolve('esbuild/bin/esbuild'), [
  resolve(consoleRoot, 'worker/index.ts'),
  '--bundle', '--platform=browser', '--format=esm', '--target=es2022',
  '--external:cloudflare:workers', `--outfile=${resolve(templateRoot, 'worker.mjs')}`,
], consoleRoot);
cpSync(resolve(consoleRoot, 'dist'), resolve(templateRoot, 'assets'), { recursive: true });
cpSync(resolve(consoleRoot, 'migrations'), resolve(templateRoot, 'migrations'), { recursive: true });
