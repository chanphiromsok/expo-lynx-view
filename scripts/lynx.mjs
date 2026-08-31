#!/usr/bin/env node

/**
 * Developer-facing Lynx workflow. Low-level release IDs, version strings,
 * token plumbing, and individual upload steps stay behind this small CLI.
 */
import { createPublicKey, randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateKeys, loadConfigAsync } from '../packages/lynx-bundle-cli/src/index.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exampleRoot = resolve(repositoryRoot, 'apps/expo-lynx-example');
const bundleCli = resolve(repositoryRoot, 'packages/lynx-bundle-cli/bin/lynx-bundle.mjs');
const deliveryCli = resolve(repositoryRoot, 'scripts/local-lynx-delivery.mjs');
const deliveryConsolePackage = '@expo-lynx/delivery-console';
const localRoot = resolve(repositoryRoot, '.local-lynx-delivery');
const localSettingsPath = resolve(localRoot, 'lynx-cli.json');
const privateKeyPath = resolve(exampleRoot, '.local-lynx-keys/updates.private.pem');
const publicKeyPath = resolve(exampleRoot, 'keys/lynx/updates.public.pem');
const bundleConfigPath = resolve(exampleRoot, 'lynx-bundle.config.mjs');
const runtimeVersion = 'expo-57';
const FEATURE_ID = /^[a-z][a-z0-9-]{0,63}$/;

function help() {
  process.stdout.write(`Lynx mini-app workflow

Usage:
  pnpm lynx init [--app path] [--feature id] [--channel-url url] [--skip-bundle] [--dry-run] [--replace-app-key]
  pnpm lynx console
  pnpm lynx local init [--replace-app-key]
  pnpm lynx local start [--host 0.0.0.0] [--port 3000]
  pnpm lynx bundle <feature>
  pnpm lynx release <feature> [--activation next-open|on-launch] [--draft]
  pnpm lynx status <feature>

Examples:
  pnpm lynx init
  pnpm lynx console
  pnpm lynx init --channel-url http://192.168.1.20:3000/v1/channels/delivery/active
  pnpm lynx local init --replace-app-key
  pnpm lynx local start
  pnpm lynx bundle delivery
  pnpm lynx release delivery

release generates the immutable release ID and display version automatically.
Use --draft to package only; use the default command to package, upload, and
promote the release to the local channel.

init prepares the Expo app's managed-delivery inputs. It never creates
Cloudflare resources or deploys a Worker; those are explicit future commands.

console starts the unified delivery console and its local Cloudflare Worker
runtime. Its hosted control-plane API is not connected yet, so it currently
displays safe local preview data only.
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
    if (value === '--draft' || value === '--replace-app-key' || value === '--skip-bundle' || value === '--dry-run') {
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

function requireActiveChannel(value) {
  if (value === undefined || value === 'active') return 'active';
  throw new Error('Only the active deployment is supported; remove --channel or use --channel active.');
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

function relativeProjectPath(projectRoot, path) {
  const value = relative(projectRoot, path).replaceAll('\\', '/');
  if (!value || value === '.') return '.';
  if (value.startsWith('../') || value === '..') throw new Error(`Path must remain inside the Expo app: ${path}`);
  return value.startsWith('./') ? value : `./${value}`;
}

async function resolveAppPaths(appArgument) {
  const appRoot = resolve(repositoryRoot, appArgument ?? 'apps/expo-lynx-example');
  const packagePath = resolve(appRoot, 'package.json');
  const appJsonPath = resolve(appRoot, 'app.json');
  const configPath = resolve(appRoot, 'lynx-bundle.config.mjs');
  if (!existsSync(packagePath)) throw new Error(`Expo app package.json was not found: ${packagePath}`);
  if (!existsSync(appJsonPath)) throw new Error(`pnpm lynx init currently requires an app.json file: ${appJsonPath}`);
  if (!existsSync(configPath)) throw new Error(`Lynx bundle config was not found: ${configPath}`);
  const bundle = await loadConfigAsync({ configPath });
  const publicKeyPath = resolve(appRoot, 'keys/lynx/updates.public.pem');
  return { appRoot, appJsonPath, configPath, bundle, privateKeyPath: bundle.privateKeyPath, publicKeyPath };
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function ensureAppPlugin(paths, featureArgument, channelUrl, dryRun) {
  let appConfig;
  try {
    appConfig = JSON.parse(readFileSync(paths.appJsonPath, 'utf8'));
  } catch {
    throw new Error(`app.json must contain valid JSON: ${paths.appJsonPath}`);
  }
  if (!appConfig || typeof appConfig !== 'object' || Array.isArray(appConfig) || !appConfig.expo || typeof appConfig.expo !== 'object' || Array.isArray(appConfig.expo)) {
    throw new Error('app.json must contain an object at the top-level "expo" key.');
  }
  const expo = appConfig.expo;
  if (expo.plugins === undefined) expo.plugins = [];
  if (!Array.isArray(expo.plugins)) throw new Error('expo.plugins must be an array before pnpm lynx init can configure expo-lynx.');

  const expected = {
    embeddedBundlesPath: relativeProjectPath(paths.appRoot, paths.bundle.embeddedOutputDir),
    publicKeyPath: relativeProjectPath(paths.appRoot, paths.publicKeyPath),
  };
  const pluginIndex = expo.plugins.findIndex((plugin) => plugin === 'expo-lynx' || (Array.isArray(plugin) && plugin[0] === 'expo-lynx'));
  let changed = false;
  let options;
  if (pluginIndex === -1) {
    options = { ...expected };
    expo.plugins.push(['expo-lynx', options]);
    changed = true;
  } else {
    const existing = expo.plugins[pluginIndex];
    if (existing === 'expo-lynx') {
      options = { ...expected };
      expo.plugins[pluginIndex] = ['expo-lynx', options];
      changed = true;
    } else {
      if (!Array.isArray(existing) || existing.length !== 2 || !existing[1] || typeof existing[1] !== 'object' || Array.isArray(existing[1])) {
        throw new Error('The expo-lynx plugin must use ["expo-lynx", { ...options }] before pnpm lynx init can update it.');
      }
      options = existing[1];
      if (Array.isArray(options.bundledResources) && options.bundledResources.length > 0) {
        throw new Error('The existing expo-lynx plugin uses legacy bundledResources. Migrate it to embeddedBundlesPath/publicKeyPath before running pnpm lynx init.');
      }
      for (const [key, value] of Object.entries(expected)) {
        if (options[key] === undefined) {
          options[key] = value;
          changed = true;
        }
      }
    }
  }

  if (channelUrl !== undefined) {
    let parsed;
    try {
      parsed = new URL(channelUrl);
    } catch {
      throw new Error('--channel-url must be an absolute http(s) URL.');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('--channel-url must use http or https.');
    const featureIds = Object.keys(paths.bundle.features);
    const feature = featureArgument === undefined
      ? (featureIds.length === 1 ? featureIds[0] : null)
      : requireFeature(featureArgument);
    if (!feature) throw new Error('--channel-url needs --feature when the bundle config contains more than one feature.');
    if (!featureIds.includes(feature)) throw new Error(`The configured Lynx feature does not exist: ${feature}`);
    const channels = options.deliveryChannels ?? {};
    if (!channels || typeof channels !== 'object' || Array.isArray(channels)) throw new Error('expo-lynx deliveryChannels must be an object.');
    const featureChannels = channels[feature] ?? {};
    if (!featureChannels || typeof featureChannels !== 'object' || Array.isArray(featureChannels)) throw new Error(`expo-lynx deliveryChannels.${feature} must be an object.`);
    if (featureChannels.active !== channelUrl) {
      options.deliveryChannels = { ...channels, [feature]: { active: channelUrl } };
      changed = true;
    }
  }

  if (changed) {
    if (dryRun) process.stdout.write(`Would update Expo plugin configuration: ${paths.appJsonPath}\n`);
    else {
      writeJson(paths.appJsonPath, appConfig);
      process.stdout.write(`Configured expo-lynx in ${paths.appJsonPath}\n`);
    }
  } else {
    process.stdout.write(`Expo plugin configuration is already ready: ${paths.appJsonPath}\n`);
  }
}

function ensureSigningKeys(paths, replaceAppKey, dryRun) {
  const hasPrivate = existsSync(paths.privateKeyPath);
  const hasPublic = existsSync(paths.publicKeyPath);
  if (hasPrivate && hasPublic) {
    process.stdout.write(`Signing trust root is already ready: ${paths.publicKeyPath}\n`);
    return;
  }
  if (hasPrivate && !hasPublic) {
    if (dryRun) {
      process.stdout.write(`Would restore the public verification key at ${paths.publicKeyPath}\n`);
      return;
    }
    mkdirSync(dirname(paths.publicKeyPath), { recursive: true, mode: 0o700 });
    const publicPem = createPublicKey(readFileSync(paths.privateKeyPath, 'utf8')).export({ type: 'spki', format: 'pem' });
    writeFileSync(paths.publicKeyPath, publicPem, { mode: 0o644 });
    process.stdout.write(`Restored the public verification key at ${paths.publicKeyPath}\n`);
    return;
  }
  if (!hasPrivate && hasPublic && !replaceAppKey) {
    throw new Error(`The app already embeds a public key but the matching private key is unavailable. Refusing to replace the trust root. Restore the private key or run: pnpm lynx init --replace-app-key`);
  }
  if (dryRun) {
    process.stdout.write(`Would generate a local RSA signing pair at ${dirname(paths.privateKeyPath)}\n`);
    process.stdout.write(`Would write the public verification key at ${paths.publicKeyPath}\n`);
    return;
  }
  const keyDirectory = dirname(paths.privateKeyPath);
  const generated = generateKeys(keyDirectory);
  mkdirSync(dirname(paths.publicKeyPath), { recursive: true, mode: 0o700 });
  cpSync(generated.publicKeyPath, paths.publicKeyPath, { force: replaceAppKey });
  process.stdout.write(`Generated a local signing pair. The private key is ignored at ${generated.privateKeyPath}.\n`);
  process.stdout.write(`Updated the app public key at ${paths.publicKeyPath}.\n`);
  process.stdout.write('Run Expo prebuild and make one new internal iOS build before this new trust root can be used.\n');
}

async function initProject(options) {
  const paths = await resolveAppPaths(options.get('--app'));
  const dryRun = options.get('--dry-run') === true;
  const feature = options.get('--feature');
  const channelUrl = options.get('--channel-url');
  ensureAppPlugin(paths, feature, channelUrl, dryRun);
  ensureSigningKeys(paths, options.get('--replace-app-key') === true, dryRun);
  if (options.get('--skip-bundle') === true) {
    process.stdout.write('Skipped embedded baseline build (--skip-bundle).\n');
  } else if (dryRun) {
    process.stdout.write(`Would build the embedded baseline from ${paths.configPath}\n`);
  } else {
    run(process.execPath, [bundleCli, 'build-embedded', '--config', paths.configPath, '--runtime-version', runtimeVersion]);
    process.stdout.write(`Built embedded baselines at ${paths.bundle.embeddedOutputDir}\n`);
  }
  process.stdout.write(`\nNext required native step:\n  cd ${relative(repositoryRoot, paths.appRoot)} && pnpm exec expo prebuild --platform ios\n`);
  process.stdout.write('Then install one new iOS development build. Cloudflare provisioning and Worker deployment are not run by this command yet.\n');
}

function localInit(replaceAppKey) {
  const paths = {
    privateKeyPath,
    publicKeyPath,
  };
  ensureSigningKeys(paths, replaceAppKey, false);
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

function startConsole() {
  process.stdout.write('Starting the Expo Lynx Delivery Console with its local Cloudflare Worker runtime.\n');
  const child = spawn('pnpm', ['--filter', deliveryConsolePackage, 'dev'], { cwd: repositoryRoot, stdio: 'inherit' });
  child.once('error', (error) => { throw error; });
  child.once('exit', (code) => { process.exitCode = code ?? 1; });
}

function buildEmbedded(feature) {
  run(process.execPath, [bundleCli, 'build-embedded', feature, '--config', bundleConfigPath, '--runtime-version', runtimeVersion]);
}

function release(feature, options) {
  const channel = requireActiveChannel(options.get('--channel'));
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
  const channel = requireActiveChannel(options.get('--channel'));
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
  const [scope, ...argumentsList] = process.argv.slice(2);
  if (!scope || scope === '--help' || scope === '-h') {
    help();
    return;
  }
  if (scope === 'init') {
    const { options, positionals } = parseOptions(argumentsList);
    if (positionals.length > 0) throw new Error(`Unexpected init arguments: ${positionals.join(' ')}`);
    await initProject(options);
    return;
  }
  if (scope === 'console') {
    if (argumentsList.length > 0) throw new Error('pnpm lynx console does not accept arguments.');
    startConsole();
    return;
  }
  const [command, ...rest] = argumentsList;
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
