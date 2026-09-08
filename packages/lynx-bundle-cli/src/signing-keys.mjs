import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import { loadExpoConfig } from './expo-config.mjs';

export function generateSigningKeyPair({
  cwd = process.cwd(),
  publicKeyPath,
  privateKeyPath,
} = {}) {
  const root = resolve(cwd);
  const publicPath = resolve(root, publicKeyPath ?? configuredPublicKeyPath(root));
  const privatePath = resolve(root, privateKeyPath ?? '.local-lynx-keys/updates.private.pem');
  if (publicPath === privatePath) throw new Error('Public and private key paths must be different.');
  if (existsSync(privatePath) && !existsSync(publicPath)) {
    const privateKey = createPrivateKey(readFileSync(privatePath, 'utf8'));
    if (privateKey.asymmetricKeyType !== 'rsa' || privateKey.asymmetricKeyDetails?.modulusLength !== 3072) {
      throw new Error('The existing private key is not an RSA-3072 delivery signing key. Refusing to create a mismatched mobile trust key.');
    }
    mkdirSync(dirname(publicPath), { recursive: true, mode: 0o700 });
    writeFileSync(publicPath, createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }), { mode: 0o644, flag: 'wx' });
    return {
      publicKeyPath: relative(root, publicPath),
      privateKeyPath: relative(root, privatePath),
      status: 'restored-public-key',
    };
  }
  if (existsSync(publicPath) || existsSync(privatePath)) {
    throw new Error('A signing key already exists at the requested path. Refusing to overwrite a trust key.');
  }

  const pair = generateKeyPairSync('rsa', { modulusLength: 3072, publicExponent: 65_537 });
  mkdirSync(dirname(publicPath), { recursive: true, mode: 0o700 });
  mkdirSync(dirname(privatePath), { recursive: true, mode: 0o700 });
  writeFileSync(publicPath, pair.publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644, flag: 'wx' });
  writeFileSync(privatePath, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
  return {
    publicKeyPath: relative(root, publicPath),
    privateKeyPath: relative(root, privatePath),
    status: 'created',
  };
}

export function configuredPublicKeyPath(root) {
  const expo = loadExpoConfig(root);
  const plugin = Array.isArray(expo?.plugins)
    ? expo.plugins.find((item) => Array.isArray(item) && item[0] === 'expo-lynx-view')
    : null;
  const path = plugin?.[1]?.publicKeyPath;
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error('Expo config must configure expo-lynx-view publicKeyPath, or pass --public-key-path.');
  }
  return path;
}
