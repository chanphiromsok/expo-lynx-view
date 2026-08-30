#!/usr/bin/env node

/**
 * Developer-facing Lynx workflow. Low-level release IDs, version strings,
 * token plumbing, and individual upload steps stay behind this small CLI.
 */
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateKeys } from '../packages/lynx-bundle-cli/src/index.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exampleRoot = resolve(repositoryRoot, 'apps/expo-lynx-example');
const bundleCli = resolve(repositoryRoot, 'packages/lynx-bundle-cli/bin/lynx-bundle.mjs');
const deliveryCli = resolve(repositoryRoot, 'scripts/local-lynx-delivery.mjs');
const localRoot = resolve(repositoryRoot, '.local-lynx-delivery');
const localSettingsPath = resolve(localRoot, 'lynx-cli.json');
const privateKeyPath = resolve(exampleRoot, '.local-lynx-keys/updates.private.pem');
const publicKeyPath = resolve(exampleRoot, 'keys/lynx/updates.public.pem');
const bundleConfigPath = resolve(exampleRoot, 'lynx-bundle.config.mjs');
const runtimeVersion = 'expo-57';
const FEATURE_ID = /^[a-z][a-z0-9-]{0,63}$/;
const CHANNEL_ID = /^[a-z][a-z0-9-]{0,31}$/;

function help() {
  process.stdout.write(`Lynx mini-app workflow

Usage:
  pnpm lynx local init [--replace-app-key]
  pnpm lynx local start [--host 0.0.0.0] [--port 3000]
  pnpm lynx bundle <feature>
  pnpm lynx release <feature> [--channel stable] [--activation next-open|on-launch] [--draft]
  pnpm lynx status <feature> [--channel stable]

Examples:
  pnpm lynx local init --replace-app-key
  pnpm lynx local start
  pnpm lynx bundle delivery
  pnpm lynx release delivery

release generates the immutable release ID and display version automatically.
Use --draft to package only; use the default command to package, upload, and
promote the release to the local channel.
`);
}

function parseOptions(values) {
  const options = new Map();
  const positionals = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) {
      positionals.push(value);
      continue;
    }
    if (value === '--draft' || value === '--replace-app-key') {
      options.set(value, true);
      continue;
    }
    const next = values[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`${value} requires a value.`);
    options.set(value, next);
    index += 1;
  }
  return { options, positionals };
}

function requireFeature(value) {
  if (!FEATURE_ID.test(value ?? '')) throw new Error('Feature must be a safe canonical name, for example delivery.');
  return value;
}

function requireChannel(value) {
  if (!CHANNEL_ID.test(value ?? '')) throw new Error('Channel must be a safe canonical name, for example stable.');
  return value;
}

function run(command, argumentsList) {
  const result = spawnSync(command, argumentsList, { cwd: repositoryRoot, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}.`);
}

function ensureLocalRoot() {
  mkdirSync(localRoot, { recursive: true, mode: 0o700 });
}

function saveSettings(value) {
  ensureLocalRoot();
  writeFileSync(localSettingsPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function loadSettings() {
  if (!existsSync(localSettingsPath)) throw new Error('Local delivery is not initialized. Run: pnpm lynx local start');
  try {
    const value = JSON.parse(readFileSync(localSettingsPath, 'utf8'));
    if (!value || typeof value.server !== 'string' || typeof value.token !== 'string') throw new Error('invalid');
    return value;
  } catch {
    throw new Error('Local delivery settings are unreadable. Delete .local-lynx-delivery/lynx-cli.json and run: pnpm lynx local start');
  }
}

function generatedReleaseId(feature) {
  const now = new Date();
  const compact = now.toISOString().replace(/[-:.]/g, '').replace('Z', 'Z');
  return `${feature}-${compact}-${randomBytes(3).toString('hex')}`;
}

function generatedVersion() {
  return `local-${new Date().toISOString().replace(/[-:.]/g, '').replace('Z', '')}`;
}

function localInit(replaceAppKey) {
  if (existsSync(privateKeyPath)) {
    process.stdout.write(`Local signing key already exists: ${privateKeyPath}\n`);
    if (!existsSync(publicKeyPath)) throw new Error('The app public key is missing. Restore it from the matching private key before using local delivery.');
    return;
  }
  if (existsSync(publicKeyPath) && !replaceAppKey) {
    throw new Error('The app already embeds a public key. Generate a matching local pair only when you explicitly replace it: pnpm lynx local init --replace-app-key');
  }
  const keyDirectory = dirname(privateKeyPath);
  const generated = generateKeys(keyDirectory);
  mkdirSync(dirname(publicKeyPath), { recursive: true, mode: 0o700 });
  cpSync(generated.publicKeyPath, publicKeyPath, { force: replaceAppKey });
  process.stdout.write(`Generated a local signing pair. The private key is ignored at ${generated.privateKeyPath}.\n`);
  process.stdout.write(`Updated the app public key at ${publicKeyPath}.\n`);
  process.stdout.write('Run Expo prebuild and make one new internal iOS build before this new trust root can be used.\n');
}

function localStart(options) {
  if (!existsSync(privateKeyPath) || !existsSync(publicKeyPath)) {
    throw new Error('Missing local signing keys. Run: pnpm lynx local init --replace-app-key');
  }
  const host = options.get('--host') ?? '0.0.0.0';
  const port = Number(options.get('--port') ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be between 1 and 65535.');
  const prior = existsSync(localSettingsPath) ? loadSettings() : null;
  const settings = { server: `http://127.0.0.1:${port}`, token: prior?.token ?? randomBytes(32).toString('hex'), host, port };
  saveSettings(settings);
  process.stdout.write('Local publisher token is stored in ignored .local-lynx-delivery/lynx-cli.json.\n');
  const child = spawn(process.execPath, [deliveryCli, 'serve', '--host', host, '--port', String(port), '--token', settings.token, '--private-key', privateKeyPath, '--public-key', publicKeyPath], { cwd: repositoryRoot, stdio: 'inherit' });
  child.once('error', (error) => { throw error; });
  child.once('exit', (code) => { process.exitCode = code ?? 1; });
}

function buildEmbedded(feature) {
  run(process.execPath, [bundleCli, 'build-embedded', feature, '--config', bundleConfigPath, '--runtime-version', runtimeVersion]);
}

function release(feature, options) {
  const channel = requireChannel(options.get('--channel') ?? 'stable');
  const selectedActivation = options.get('--activation') ?? 'next-open';
  if (selectedActivation !== 'next-open' && selectedActivation !== 'on-launch') throw new Error('--activation must be next-open or on-launch.');
  const releaseId = generatedReleaseId(feature);
  const version = generatedVersion();
  process.stdout.write(`Preparing ${feature}. Release identity is generated automatically.\n`);
  run(process.execPath, [bundleCli, 'pack', feature, '--config', bundleConfigPath, '--release-id', releaseId, '--version', version, '--platform', 'ios', '--runtime-version', runtimeVersion]);
  const releaseDirectory = resolve(exampleRoot, 'dist/lynx-releases', feature, releaseId);
  if (options.get('--draft')) {
    process.stdout.write(`Draft package ready: ${releaseDirectory}\n`);
    return;
  }
  const settings = loadSettings();
  run(process.execPath, [deliveryCli, 'publish', '--server', settings.server, '--token', settings.token, '--release-dir', releaseDirectory, '--channel', channel, '--activation', selectedActivation]);
  process.stdout.write(`Ready: ${feature}/${channel}. The signed update activates according to ${selectedActivation}.\n`);
}

async function status(feature, options) {
  const channel = requireChannel(options.get('--channel') ?? 'stable');
  const settings = loadSettings();
  const response = await fetch(`${settings.server}/v1/channels/${feature}/${channel}`);
  if (response.status === 404) {
    process.stdout.write(`No local release has been promoted for ${feature}/${channel}.\n`);
    return;
  }
  if (!response.ok) throw new Error(`Local server returned ${response.status}. Start it with: pnpm lynx local start`);
  const envelope = await response.json();
  const payload = JSON.parse(Buffer.from(envelope.payload, 'base64url').toString('utf8'));
  process.stdout.write(`${JSON.stringify({ feature: payload.feature, channel: payload.channel, releaseId: payload.releaseId, revision: payload.revision, activation: payload.activation, force: payload.force, issuedAt: payload.issuedAt }, null, 2)}\n`);
}

async function main() {
  const [scope, command, ...rest] = process.argv.slice(2);
  if (!scope || scope === '--help' || scope === '-h') {
    help();
    return;
  }
  const { options, positionals } = parseOptions(rest);
  if (scope === 'local' && command === 'init') {
    localInit(options.get('--replace-app-key') === true);
    return;
  }
  if (scope === 'local' && command === 'start') {
    localStart(options);
    return;
  }
  if (scope === 'bundle' && command) {
    buildEmbedded(requireFeature(command));
    return;
  }
  if (scope === 'release' && command) {
    release(requireFeature(command), options);
    return;
  }
  if (scope === 'status' && command) {
    await status(requireFeature(command), options);
    return;
  }
  if (positionals.length > 0) throw new Error(`Unexpected arguments: ${positionals.join(' ')}`);
  help();
  process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
