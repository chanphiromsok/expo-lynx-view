import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createNativeRuntimeVersion } from './index.mjs';
import { loadExpoConfig } from './expo-config.mjs';

export async function prepareHostRuntime({ cwd = process.cwd(), platform = 'ios', runtimeFactory = createNativeRuntimeVersion } = {}) {
  assertManagedPlatform(platform);
  const host = readHost(cwd, platform);
  const runtimeVersion = await runtimeFactory(host.root, platform);
  const registryPath = embeddedRegistryPath(host);
  assertEmbeddedBaseline(registryPath);
  const registry = readJson(registryPath, 'Embedded registry');
  assertRegistry(registry, host.features);
  registry.runtimes[platform] = {
    runtimeVersion,
    appVersion: host.appVersion,
    buildNumber: host.buildNumber,
  };
  writeJsonAtomic(registryPath, registry);
  return { ...host, platform, runtimeVersion };
}

export async function registerPreparedHostRuntime({ cwd = process.cwd(), platform = 'ios', server = process.env.LYNX_DELIVERY_SERVER, apiKey = process.env.LYNX_DELIVERY_API_KEY, fetchImpl = fetch, runtimeFactory = createNativeRuntimeVersion } = {}) {
  assertManagedPlatform(platform);
  const host = readHost(cwd, platform);
  const registryPath = embeddedRegistryPath(host);
  assertEmbeddedBaseline(registryPath);
  const registry = readJson(registryPath, 'Embedded registry');
  assertRegistry(registry, host.features);
  const prepared = registry.runtimes[platform];
  if (!prepared || typeof prepared !== 'object') {
    throw new Error(`The ${platform} host is not prepared. Run lynx host prepare --platform ${platform}.`);
  }
  const actualRuntime = await runtimeFactory(host.root, platform);
  if (prepared.runtimeVersion !== actualRuntime || prepared.appVersion !== host.appVersion || prepared.buildNumber !== host.buildNumber) {
    throw new Error('The host project changed after lynx host prepare. Run lynx host prepare again before registering.');
  }
  if (typeof apiKey !== 'string' || apiKey.length === 0) throw new Error('A delivery API key is required. Set LYNX_DELIVERY_API_KEY.');
  const endpoint = normalizeServer(server ?? host.workerOrigin);
  const response = await fetchImpl(`${endpoint}/api/apps/${encodeURIComponent(host.appId)}/runtime`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: 1,
      platform,
      runtimeVersion: prepared.runtimeVersion,
      appVersion: host.appVersion,
      buildNumber: host.buildNumber,
      features: host.features,
    }),
  }).catch((error) => {
    throw new Error(`Host registration could not reach ${endpoint}${error instanceof Error && error.message ? ` (${error.message})` : ''}.`);
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = body?.error?.message;
    throw new Error(`Host registration failed with HTTP ${response.status}${typeof message === 'string' ? ` — ${message}` : ''}.`);
  }
  return { appId: host.appId, platform, appVersion: host.appVersion, buildNumber: host.buildNumber, features: host.features };
}

function assertManagedPlatform(platform) {
  if (platform !== 'ios' && platform !== 'android') throw new Error('platform must be ios or android.');
}

export function readHost(cwd = process.cwd(), platform) {
  if (platform !== undefined) assertManagedPlatform(platform);
  const root = resolve(cwd);
  const app = loadExpoConfig(root);
  if (!app || typeof app !== 'object') throw new Error('Expo configuration must contain an object.');
  const plugin = Array.isArray(app.plugins)
    ? app.plugins.find((item) => Array.isArray(item) && item[0] === 'expo-lynx-view')
    : null;
  const options = plugin?.[1];
  if (!options || typeof options !== 'object' || typeof options.embeddedBundlesPath !== 'string' || !options.deliveryEndpoints || typeof options.deliveryEndpoints !== 'object') {
    throw new Error('Expo config must configure expo-lynx-view with embeddedBundlesPath and deliveryEndpoints.');
  }
  const buildNumber = platform === undefined ? undefined : platform === 'ios' ? app.ios?.buildNumber : app.android?.versionCode;
  if (platform !== undefined && (typeof app.version !== 'string' || app.version.length === 0 || (typeof buildNumber !== 'string' && typeof buildNumber !== 'number') || String(buildNumber).length === 0)) {
    throw new Error(`Expo config must declare expo.version and expo.${platform === 'ios' ? 'ios.buildNumber' : 'android.versionCode'} before host preparation.`);
  }
  const entries = Object.entries(options.deliveryEndpoints);
  if (entries.length === 0 || entries.some(([feature, value]) => typeof feature !== 'string' || typeof value !== 'string')) {
    throw new Error('expo-lynx-view deliveryEndpoints must contain at least one feature URL.');
  }
  const parsed = entries.map(([feature, value]) => ({ feature, ...parseDeliveryEndpoint(value) }));
  const appIds = [...new Set(parsed.map((entry) => entry.appId))];
  const origins = [...new Set(parsed.map((entry) => entry.origin))];
  if (appIds.length !== 1 || origins.length !== 1 || parsed.some(({ feature, featureId }) => feature !== featureId)) {
    throw new Error('deliveryEndpoints must use one Worker origin and canonical /v1/<appId>/<feature> paths.');
  }
  return {
    root,
    appId: appIds[0],
    ...(platform === undefined ? {} : { appVersion: app.version, buildNumber: String(buildNumber) }),
    embeddedBundlesPath: options.embeddedBundlesPath,
    features: parsed.map(({ feature }) => feature).sort(),
    workerOrigin: origins[0],
  };
}

function parseDeliveryEndpoint(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`Invalid delivery endpoint: ${value}`); }
  const match = url.pathname.match(/^\/v1\/([a-z][a-z0-9-]{0,63})\/([a-z][a-z0-9-]{0,63})$/);
  if (!match || url.search || url.hash || url.username || url.password || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
    throw new Error(`Delivery endpoint must be a credential-free canonical /v1/<appId>/<feature> URL: ${value}`);
  }
  return { origin: url.origin, appId: match[1], featureId: match[2] };
}

function assertRegistry(registry, features) {
  if (!registry || registry.schemaVersion !== 2 || !registry.features || typeof registry.features !== 'object' || !registry.runtimes || typeof registry.runtimes !== 'object') {
    throw new Error('Embedded registry is malformed. Build the embedded baseline first.');
  }
  const actual = Object.keys(registry.features).sort();
  if (JSON.stringify(actual) !== JSON.stringify(features)) throw new Error('Embedded registry features do not match deliveryEndpoints.');
  for (const feature of features) {
    const entry = registry.features[feature];
    if (!entry || typeof entry !== 'object' || entry.baseline !== `${feature}/baseline.json` || Object.keys(entry).length !== 1) throw new Error(`Embedded registry entry is invalid for ${feature}.`);
  }
}

function embeddedRegistryPath(host) {
  return resolve(host.root, host.embeddedBundlesPath, 'registry.json');
}

function assertEmbeddedBaseline(registryPath) {
  if (!existsSync(registryPath)) {
    throw new Error('No embedded baseline exists. Run lynx host embed <mini-app-directory> first.');
  }
}

function normalizeServer(value) {
  try {
    const url = new URL(value);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.search && !url.hash) return url.origin;
  } catch { /* checked below */ }
  throw new Error('LYNX_DELIVERY_SERVER must be an absolute http(s) Worker URL.');
}

function readJson(path, label) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { throw new Error(`${label} could not be read: ${path}`); }
}

function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}
