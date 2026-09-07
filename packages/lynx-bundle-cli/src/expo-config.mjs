import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

export function loadExpoConfig(cwd, configReader, dynamicConfigReader) {
  const root = resolve(cwd);
  const appJsonPath = resolve(root, 'app.json');
  if (existsSync(appJsonPath)) return readJson(appJsonPath, 'app.json').expo;

  const configPath = ['app.config.ts', 'app.config.mjs', 'app.config.js', 'app.config.cjs']
    .map((name) => resolve(root, name))
    .find(existsSync);
  if (!configPath) throw new Error('No app.json or app.config file found.');

  try {
    const getConfig = configReader ?? getHostExpoConfig(root);
    const result = getConfig(root, { skipSDKVersionRequirement: true, isPublicConfig: true, skipPlugins: true });
    if (configReader && !dynamicConfigReader) return result.exp;
    const getDynamicConfig = dynamicConfigReader ?? getHostDynamicExpoConfig(root);
    const dynamic = getDynamicConfig(configPath, {
      projectRoot: root,
      staticConfigPath: ['app.config.json', 'app.json'].map((name) => resolve(root, name)).find(existsSync),
      packageJsonPath: resolve(root, 'package.json'),
      config: result.exp,
    });
    return { ...result.exp, ...dynamic.config, plugins: dynamic.config.plugins ?? result.exp.plugins };
  } catch (error) {
    const detail = error instanceof Error ? error.message.split('\n')[0] : '';
    throw new Error(`Expo could not resolve ${configPath} without config plugins${detail ? ` (${detail})` : ''}.`);
  }
}

function getHostExpoConfig(root) {
  return getHostExpoRequire(root)('@expo/config').getConfig;
}

function getHostDynamicExpoConfig(root) {
  return getHostExpoRequire(root)('@expo/config/build/getConfig').getDynamicConfig;
}

function getHostExpoRequire(root) {
  const fromHost = createRequire(resolve(root, 'package.json'));
  try {
    fromHost.resolve('@expo/config/package.json');
    return fromHost;
  } catch {
    return createRequire(fromHost.resolve('expo/package.json'));
  }
}

function readJson(path, label) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { throw new Error(`${label} could not be read: ${path}`); }
}
