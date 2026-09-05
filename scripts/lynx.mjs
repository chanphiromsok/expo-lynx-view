#!/usr/bin/env node

/**
 * Developer-facing Lynx workflow. Low-level release IDs, version strings,
 * token plumbing, and individual upload steps stay behind this small CLI.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  createNativeRuntimeVersion,
  loadConfigAsync,
  readEmbeddedRuntimeVersion,
} from '../packages/lynx-bundle-cli/src/index.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exampleRoot = resolve(repositoryRoot, 'apps/expo-lynx-example');
const bundleCli = resolve(repositoryRoot, 'packages/lynx-bundle-cli/bin/lynx-bundle.mjs');
const deliveryConsolePackage = '@expo-lynx/delivery-console';
const bundleConfigPath = resolve(exampleRoot, 'lynx-bundle.config.mjs');
const operationalCli = resolve(repositoryRoot, 'packages/lynx-bundle-cli/bin/lynx.mjs');
const localDeliveryEnvPath = resolve(repositoryRoot, 'apps/console/.dev.vars');
const FEATURE_ID = /^[a-z][a-z0-9-]{0,63}$/;

function help() {
  process.stdout.write(`Lynx mini-app workflow

Usage:
  pnpm lynx init [--app path] [--feature id] [--channel-url url] [--skip-bundle] [--dry-run]
  pnpm lynx console
  pnpm lynx console setup --username <username> [--dry-run]
  pnpm lynx bundle <feature>
  pnpm lynx release <feature> [--server url] [--api-key value] [--draft]
  pnpm lynx release upload <release-directory> --server url [--api-key value]

Examples:
  pnpm lynx init
  pnpm lynx console
  pnpm lynx init --channel-url https://delivery.example/v1/deploy/delivery
  pnpm lynx bundle delivery
  pnpm lynx release delivery
  LYNX_DELIVERY_API_KEY=... pnpm lynx release upload ./dist/lynx-releases/delivery/delivery-20260830T143512-a1b2c3 --server http://127.0.0.1:8787

release generates the immutable release ID and display version automatically,
then builds, packages, and uploads it to the delivery Worker. Use
--draft to stop after packaging. Uploading never promotes or enables a bundle;
make that explicit choice in the console.

For local development, release automatically reads the ignored
apps/console/.dev.vars file: INITIAL_ADMIN_API_KEY becomes the local CLI credential
and the server defaults to http://127.0.0.1:8787. Explicit --server/--api-key
arguments or LYNX_DELIVERY_* environment variables always take precedence.

init prepares the Expo app's managed-delivery inputs. It never creates
Cloudflare resources or deploys a Worker; those are explicit future commands.

release upload sends a packed release.json and release.zip to the delivery Worker.
The Worker returns a short-lived R2 PUT URL, validates the uploaded immutable bytes, then
records the verified bundle. It does not activate the bundle.

console starts the unified delivery console and its local Cloudflare Worker runtime.
console setup is the Oclif command that provisions remote delivery infrastructure.
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
    if (value === '--draft' || value === '--json' || value === '--skip-bundle' || value === '--dry-run') {
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

function run(command, argumentsList) {
  const result = spawnSync(command, argumentsList, { cwd: repositoryRoot, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}.`);
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
  return { appRoot, appJsonPath, configPath, bundle, publicKeyPath };
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
  if (!Array.isArray(expo.plugins)) throw new Error('expo.plugins must be an array before pnpm lynx init can configure expo-lynx-view.');

  const expected = {
    embeddedBundlesPath: relativeProjectPath(paths.appRoot, paths.bundle.embeddedOutputDir),
    publicKeyPath: relativeProjectPath(paths.appRoot, paths.publicKeyPath),
  };
  const pluginIndex = expo.plugins.findIndex(
    (plugin) =>
      plugin === 'expo-lynx-view' ||
      plugin === 'expo-lynx' ||
      (Array.isArray(plugin) && (plugin[0] === 'expo-lynx-view' || plugin[0] === 'expo-lynx'))
  );
  let changed = false;
  let options;
  if (pluginIndex === -1) {
    options = { ...expected };
    expo.plugins.push(['expo-lynx-view', options]);
    changed = true;
  } else {
    const existing = expo.plugins[pluginIndex];
    if (existing === 'expo-lynx-view' || existing === 'expo-lynx') {
      options = { ...expected };
      expo.plugins[pluginIndex] = ['expo-lynx-view', options];
      changed = true;
    } else {
      if (!Array.isArray(existing) || existing.length !== 2 || !existing[1] || typeof existing[1] !== 'object' || Array.isArray(existing[1])) {
        throw new Error('The expo-lynx-view plugin must use ["expo-lynx-view", { ...options }] before pnpm lynx init can update it.');
      }
      options = existing[1];
      if (existing[0] === 'expo-lynx') {
        existing[0] = 'expo-lynx-view';
        changed = true;
      }
      if (Array.isArray(options.bundledResources) && options.bundledResources.length > 0) {
        throw new Error('The existing expo-lynx-view plugin uses legacy bundledResources. Migrate it to embeddedBundlesPath/publicKeyPath before running pnpm lynx init.');
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
    const endpoints = options.deliveryEndpoints ?? {};
    if (!endpoints || typeof endpoints !== 'object' || Array.isArray(endpoints)) throw new Error('expo-lynx-view deliveryEndpoints must be an object.');
    if (endpoints[feature] !== channelUrl) {
      options.deliveryEndpoints = { ...endpoints, [feature]: channelUrl };
      changed = true;
    }
  }

  if (changed) {
    if (dryRun) process.stdout.write(`Would update Expo plugin configuration: ${paths.appJsonPath}\n`);
    else {
      writeJson(paths.appJsonPath, appConfig);
      process.stdout.write(`Configured expo-lynx-view in ${paths.appJsonPath}\n`);
    }
  } else {
    process.stdout.write(`expo-lynx-view plugin configuration is already ready: ${paths.appJsonPath}\n`);
  }
}

async function initProject(options) {
  const paths = await resolveAppPaths(options.get('--app'));
  const dryRun = options.get('--dry-run') === true;
  const feature = options.get('--feature');
  const channelUrl = options.get('--channel-url');
  if (!existsSync(paths.publicKeyPath)) {
    throw new Error(`The mobile verification public key is missing: ${paths.publicKeyPath}. Provision the matching Worker signing key and public key before running pnpm lynx init.`);
  }
  ensureAppPlugin(paths, feature, channelUrl, dryRun);
  if (options.get('--skip-bundle') === true) {
    process.stdout.write('Skipped embedded baseline build (--skip-bundle).\n');
  } else if (dryRun) {
    process.stdout.write(`Would build the embedded baseline from ${paths.configPath}\n`);
  } else {
    const runtimeVersion = await createNativeRuntimeVersion(paths.appRoot);
    run(process.execPath, [bundleCli, 'build-embedded', '--config', paths.configPath, '--runtime-version', runtimeVersion]);
    process.stdout.write(`Built embedded baselines at ${paths.bundle.embeddedOutputDir}\n`);
  }
  process.stdout.write(`\nNext required native step:\n  cd ${relative(repositoryRoot, paths.appRoot)} && pnpm exec expo prebuild --platform ios\n`);
  process.stdout.write('Then install one new iOS development build. Cloudflare provisioning and Worker deployment are not run by this command yet.\n');
}

function startConsole() {
  process.stdout.write('Starting the Expo Lynx Delivery Console and LAN-accessible local Worker.\n');
  const child = spawn('pnpm', ['--filter', deliveryConsolePackage, 'dev:device'], { cwd: repositoryRoot, stdio: 'inherit' });
  child.once('error', (error) => { throw error; });
  child.once('exit', (code) => { process.exitCode = code ?? 1; });
}

async function buildEmbedded(feature) {
  const runtimeVersion = await createNativeRuntimeVersion(exampleRoot);
  run(process.execPath, [bundleCli, 'build-embedded', feature, '--config', bundleConfigPath, '--runtime-version', runtimeVersion]);
}

function configureLocalDeliveryUpload() {
  process.env.LYNX_DELIVERY_SERVER = 'http://127.0.0.1:8787';
  if (existsSync(localDeliveryEnvPath)) {
    loadEnvFile(localDeliveryEnvPath);
    if (!process.env.LYNX_DELIVERY_API_KEY && process.env.INITIAL_ADMIN_API_KEY) {
      process.env.LYNX_DELIVERY_API_KEY = process.env.INITIAL_ADMIN_API_KEY;
    }
  }
}

async function release(feature, options) {
  if (options.has('--channel') || options.has('--activation')) {
    throw new Error('Release channels and activation flags were retired. Upload first, then select and enable the bundle in the console.');
  }
  const releaseId = generatedReleaseId(feature);
  const version = generatedVersion();
  const runtimeVersion = readEmbeddedRuntimeVersion(
    await loadConfigAsync({ configPath: bundleConfigPath })
  );
  process.stdout.write(`Preparing ${feature}. Release identity is generated automatically.\n`);
  run(process.execPath, [bundleCli, 'pack', feature, '--config', bundleConfigPath, '--release-id', releaseId, '--version', version, '--platform', 'ios', '--runtime-version', runtimeVersion]);
  const releaseDirectory = resolve(exampleRoot, 'dist/lynx-releases', feature, releaseId);
  if (options.get('--draft')) {
    process.stdout.write(`Draft package ready: ${releaseDirectory}\n`);
    return;
  }
  const uploadArguments = [operationalCli, 'release:upload', releaseDirectory];
  const server = options.get('--server');
  const apiKey = options.get('--api-key');
  if (!server && !apiKey && !process.env.LYNX_DELIVERY_SERVER && !process.env.LYNX_DELIVERY_API_KEY) {
    configureLocalDeliveryUpload();
  }
  if (server) uploadArguments.push('--server', server);
  if (apiKey) uploadArguments.push('--api-key', apiKey);
  if (options.get('--json')) uploadArguments.push('--json');
  run(process.execPath, uploadArguments);
  process.stdout.write(`Registered bundle uploaded for ${feature}. Select it and enable delivery in the console when ready.\n`);
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
    if (argumentsList[0] === 'setup') {
      run(process.execPath, [operationalCli, 'console:setup', ...argumentsList.slice(1)]);
      return;
    }
    if (argumentsList.length > 0) throw new Error('pnpm lynx console does not accept arguments.');
    startConsole();
    return;
  }
  const [command, ...rest] = argumentsList;
  if (scope === 'release' && command === 'upload') {
    run(process.execPath, [operationalCli, 'release:upload', ...rest]);
    return;
  }
  const { options, positionals } = parseOptions(rest);
  if (scope === 'bundle' && command) {
    await buildEmbedded(requireFeature(command));
    return;
  }
  if (scope === 'release' && command) {
    await release(requireFeature(command), options);
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
