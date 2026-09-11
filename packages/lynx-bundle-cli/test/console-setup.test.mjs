import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import { setupConsole } from '../src/console-setup.mjs';
import { generateSigningKeyPair } from '../src/signing-keys.mjs';

test('validates console setup from a host project, not this monorepo', () => {
  const host = mkdtempSync(resolve(tmpdir(), 'lynx-host-console-test-'));
  writeFileSync(resolve(host, 'app.json'), JSON.stringify({ expo: {
    plugins: [['expo-lynx-view', { publicKeyPath: './keys/lynx/updates.public.pem' }]],
  } }));
  generateSigningKeyPair({ cwd: host });
  const environmentPath = resolve(host, '.env.lynx');
  writeFileSync(environmentPath, 'host configuration');
  const saved = { ...process.env };
  Object.assign(process.env, {
    CLOUDFLARE_ACCOUNT_ID: 'account-id',
    LYNX_DELIVERY_WORKER_NAME: 'host-delivery',
    LYNX_DELIVERY_D1_NAME: 'host-delivery',
    LYNX_DELIVERY_R2_BUCKET: 'host-delivery-artifacts',
    LYNX_CONSOLE_USERNAME: 'owner',
    LYNX_CONSOLE_PASSWORD: 'password',
    R2_ACCESS_KEY_ID: 'access-key',
    R2_SECRET_ACCESS_KEY: 'secret-key',
  });
  try {
    assert.doesNotThrow(() => setupConsole({ cwd: host, environmentPath, dryRun: true }));
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
    Object.assign(process.env, saved);
  }
});

test('worker-proxied uploads skip the R2 credential requirement', () => {
  const host = mkdtempSync(resolve(tmpdir(), 'lynx-host-console-test-'));
  writeFileSync(resolve(host, 'app.json'), JSON.stringify({ expo: {
    plugins: [['expo-lynx-view', { publicKeyPath: './keys/lynx/updates.public.pem' }]],
  } }));
  generateSigningKeyPair({ cwd: host });
  const environmentPath = resolve(host, '.env.lynx');
  writeFileSync(environmentPath, 'host configuration');
  const saved = { ...process.env };
  Object.assign(process.env, {
    CLOUDFLARE_ACCOUNT_ID: 'account-id',
    LYNX_DELIVERY_WORKER_NAME: 'host-delivery',
    LYNX_DELIVERY_D1_NAME: 'host-delivery',
    LYNX_DELIVERY_R2_BUCKET: 'host-delivery-artifacts',
    LYNX_CONSOLE_USERNAME: 'owner',
    LYNX_CONSOLE_PASSWORD: 'password',
    LYNX_DELIVERY_WORKER_UPLOADS: 'true',
  });
  delete process.env.R2_ACCESS_KEY_ID;
  delete process.env.R2_SECRET_ACCESS_KEY;
  try {
    assert.doesNotThrow(() => setupConsole({ cwd: host, environmentPath, dryRun: true }));
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
    Object.assign(process.env, saved);
  }
});

test('direct-to-R2 uploads (the default) still require R2 credentials', () => {
  const host = mkdtempSync(resolve(tmpdir(), 'lynx-host-console-test-'));
  writeFileSync(resolve(host, 'app.json'), JSON.stringify({ expo: {
    plugins: [['expo-lynx-view', { publicKeyPath: './keys/lynx/updates.public.pem' }]],
  } }));
  generateSigningKeyPair({ cwd: host });
  const environmentPath = resolve(host, '.env.lynx');
  writeFileSync(environmentPath, 'host configuration');
  const saved = { ...process.env };
  Object.assign(process.env, {
    CLOUDFLARE_ACCOUNT_ID: 'account-id',
    LYNX_DELIVERY_WORKER_NAME: 'host-delivery',
    LYNX_DELIVERY_D1_NAME: 'host-delivery',
    LYNX_DELIVERY_R2_BUCKET: 'host-delivery-artifacts',
    LYNX_CONSOLE_USERNAME: 'owner',
    LYNX_CONSOLE_PASSWORD: 'password',
  });
  delete process.env.LYNX_DELIVERY_WORKER_UPLOADS;
  delete process.env.R2_ACCESS_KEY_ID;
  delete process.env.R2_SECRET_ACCESS_KEY;
  try {
    assert.throws(
      () => setupConsole({ cwd: host, environmentPath, dryRun: true }),
      /R2_ACCESS_KEY_ID/,
    );
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
    Object.assign(process.env, saved);
  }
});
