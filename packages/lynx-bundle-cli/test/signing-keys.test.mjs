import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { generateSigningKeyPair } from '../src/signing-keys.mjs';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../bin/lynx.mjs');

test('generates a non-overwritable 3072-bit mobile trust pair', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'lynx-signing-key-test-'));
  const paths = generateSigningKeyPair({
    cwd: root,
    publicKeyPath: 'keys/lynx/updates.public.pem',
    privateKeyPath: '.local-lynx-keys/updates.private.pem',
  });
  const publicKey = createPublicKey(readFileSync(resolve(root, paths.publicKeyPath), 'utf8'));
  const privateKey = createPrivateKey(readFileSync(resolve(root, paths.privateKeyPath), 'utf8'));
  assert.equal(publicKey.asymmetricKeyType, 'rsa');
  assert.equal(privateKey.asymmetricKeyType, 'rsa');
  assert.equal(publicKey.asymmetricKeyDetails.modulusLength, 3072);
  assert.equal(statSync(resolve(root, paths.privateKeyPath)).mode & 0o777, 0o600);
  assert.throws(() => generateSigningKeyPair({
    cwd: root,
    publicKeyPath: paths.publicKeyPath,
    privateKeyPath: paths.privateKeyPath,
  }), /Refusing to overwrite/);
});

test('restores a configured public key from the existing local private key', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'lynx-signing-key-restore-test-'));
  const first = generateSigningKeyPair({
    cwd: root,
    publicKeyPath: '.local-lynx-keys/updates.public.pem',
    privateKeyPath: '.local-lynx-keys/updates.private.pem',
  });
  const restored = generateSigningKeyPair({
    cwd: root,
    publicKeyPath: 'keys/lynx/updates.public.pem',
    privateKeyPath: first.privateKeyPath,
  });
  assert.equal(restored.status, 'restored-public-key');
  assert.deepEqual(
    createPublicKey(readFileSync(resolve(root, restored.publicKeyPath), 'utf8')).export({ type: 'spki', format: 'der' }),
    createPublicKey(readFileSync(resolve(root, first.publicKeyPath), 'utf8')).export({ type: 'spki', format: 'der' }),
  );
});

test('exposes the human-friendly lynx keys generate command', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'lynx-signing-key-command-'));
  const result = spawnSync(process.execPath, [
    cli,
    'keys',
    'generate',
    '--public-key-path',
    'keys/lynx/updates.public.pem',
    '--private-key-path',
    '.local-lynx-keys/updates.private.pem',
    '--json',
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    publicKeyPath: 'keys/lynx/updates.public.pem',
    privateKeyPath: '.local-lynx-keys/updates.private.pem',
    status: 'created',
  });
});
