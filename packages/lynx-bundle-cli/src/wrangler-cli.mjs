import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);

export function run(command, args, cwd, { env, input } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env, input });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed.`);
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

export function wranglerPath() {
  const manifestPath = require.resolve('wrangler/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.wrangler;
  if (!bin) throw new Error('The packaged Wrangler executable could not be found. Reinstall expo-lynx-bundle-cli.');
  return resolve(dirname(manifestPath), bin);
}

export function runWrangler(args, cwd, options) {
  return run(process.execPath, [wranglerPath(), ...args], cwd, options);
}
