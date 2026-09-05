import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadMiniAppConfigAsync } from './index.mjs';

export async function inspectDeliveryWorkspace({ cwd = process.cwd(), remote = false, fetchImpl = fetch } = {}) {
  const checks = [];
  const appPath = resolve(cwd, 'app.json');
  const miniAppPath = ['lynx-miniapp.config.ts', 'lynx-miniapp.config.mjs', 'lynx-miniapp.config.js']
    .map((name) => resolve(cwd, name))
    .find(existsSync);
  if (miniAppPath) {
    const config = await loadMiniAppConfigAsync({ configPath: miniAppPath, cwd });
    checks.push(pass('mini-app-config', `${config.appId}/${config.feature}`));
  } else if (existsSync(appPath)) {
    const expo = JSON.parse(readFileSync(appPath, 'utf8'))?.expo;
    const plugin = expo?.plugins?.find?.((item) => Array.isArray(item) && item[0] === 'expo-lynx-view');
    if (!plugin?.[1]?.deliveryEndpoints) checks.push(fail('host-config', 'app.json does not configure expo-lynx-view deliveryEndpoints.'));
    else checks.push(pass('host-config', 'expo-lynx-view delivery endpoints found'));
  } else {
    checks.push(fail('workspace', 'No app.json or lynx-miniapp.config file found.'));
  }
  const requiredUploadValues = ['LYNX_DELIVERY_SERVER', 'LYNX_DELIVERY_API_KEY'];
  for (const name of requiredUploadValues) checks.push(process.env[name] ? pass(name, 'set') : fail(name, 'not set'));
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
