import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadExpoConfig } from './expo-config.mjs';
import { loadMiniAppConfigAsync } from './index.mjs';

export async function inspectDeliveryWorkspace({ cwd = process.cwd(), remote = false, fetchImpl = fetch } = {}) {
  const checks = [];
  const miniAppPath = ['lynx-miniapp.config.ts', 'lynx-miniapp.config.mjs', 'lynx-miniapp.config.js']
    .map((name) => resolve(cwd, name))
    .find(existsSync);
  if (miniAppPath) {
    const config = await loadMiniAppConfigAsync({ configPath: miniAppPath, cwd });
    checks.push(pass('mini-app-config', `${config.appId}/${config.feature}`));
  } else {
    try {
      const expo = loadExpoConfig(cwd);
      const plugin = expo?.plugins?.find?.((item) => Array.isArray(item) && item[0] === 'expo-lynx-view');
      const options = plugin?.[1];
      if (!options?.deliveryEndpoints) {
        checks.push(fail('host-config', 'Expo config does not configure expo-lynx-view deliveryEndpoints.'));
      } else {
        checks.push(pass('host-config', 'expo-lynx-view delivery endpoints found'));
      }
      const publicKeyPath = typeof options?.publicKeyPath === 'string' ? resolve(cwd, options.publicKeyPath) : null;
      checks.push(publicKeyPath && existsSync(publicKeyPath)
        ? pass('public-key', options.publicKeyPath)
        : fail('public-key', 'Configure expo-lynx-view publicKeyPath, then run lynx keys generate.'));
      checks.push(typeof expo?.version === 'string' && typeof expo?.ios?.buildNumber === 'string'
        ? pass('host-build', `${expo.version} (${expo.ios.buildNumber})`)
        : fail('host-build', 'Set expo.version and expo.ios.buildNumber before lynx host prepare.'));
    } catch (error) {
      checks.push(fail('workspace', error instanceof Error ? error.message : 'Expo config could not be read.'));
    }
  }
  if (miniAppPath) {
    const requiredUploadValues = ['LYNX_DELIVERY_SERVER', 'LYNX_DELIVERY_API_KEY'];
    for (const name of requiredUploadValues) checks.push(process.env[name] ? pass(name, 'set') : fail(name, 'not set'));
  } else if (remote && !process.env.LYNX_DELIVERY_SERVER) {
    checks.push(fail('LYNX_DELIVERY_SERVER', 'not set'));
  }
  if (remote && process.env.LYNX_DELIVERY_SERVER) {
    try {
      const response = await fetchImpl(new URL('/health', process.env.LYNX_DELIVERY_SERVER));
      checks.push(response.ok ? pass('remote', 'Worker reachable') : fail('remote', `Worker returned HTTP ${response.status}.`));
    } catch {
      checks.push(fail('remote', 'Worker could not be reached.'));
    }
  }
  return { ok: checks.every((check) => check.ok), checks };
}

function pass(name, detail) { return { name, ok: true, detail }; }
function fail(name, detail) { return { name, ok: false, detail }; }
