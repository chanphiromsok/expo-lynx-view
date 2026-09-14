import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import { resolveCreatedDatabaseId, setupConsole } from '../src/console-setup.mjs';
import { generateSigningKeyPair } from '../src/signing-keys.mjs';

const placeholderDatabaseId = '00000000-0000-0000-0000-000000000000';

test('resolveCreatedDatabaseId falls back to stdout when --update-config left the placeholder untouched', () => {
  // Reproduces a real report: `wrangler d1 create <name> --update-config
  // --config <path>` printed the real ID to stdout but did not rewrite
  // <path>, so reading the id back from that file returned the placeholder
  // still sitting there rather than the newly created database's real ID.
  const configFileContent = [
    '[[d1_databases]]',
    'binding = "DB"',
    'database_name = "tovtam"',
    `database_id = "${placeholderDatabaseId}"`,
  ].join('\n');
  const wranglerOutput = [
    "✅ Successfully created DB 'tovtam' in region APAC",
    'Created your new D1 database.',
    '',
    'To access your new D1 Database in your Worker, add the following snippet to your configuration file:',
    '[[d1_databases]]',
    'binding = "DB"',
    'database_name = "tovtam"',
    'database_id = "709ec10e-f738-4b4b-85a5-6aface62610e"',
  ].join('\n');
  assert.equal(
    resolveCreatedDatabaseId(configFileContent, wranglerOutput, placeholderDatabaseId),
    '709ec10e-f738-4b4b-85a5-6aface62610e',
  );
});

test('resolveCreatedDatabaseId trusts the config file once it actually holds a real ID', () => {
  const configFileContent = [
    '[[d1_databases]]',
    'binding = "DB"',
    'database_name = "tovtam"',
    'database_id = "709ec10e-f738-4b4b-85a5-6aface62610e"',
  ].join('\n');
  assert.equal(
    resolveCreatedDatabaseId(configFileContent, 'irrelevant', placeholderDatabaseId),
    '709ec10e-f738-4b4b-85a5-6aface62610e',
  );
});

test('resolveCreatedDatabaseId returns undefined when neither source has a real ID', () => {
  const configFileContent = `database_id = "${placeholderDatabaseId}"`;
  assert.equal(
    resolveCreatedDatabaseId(configFileContent, 'wrangler printed nothing useful', placeholderDatabaseId),
    undefined,
  );
});

function withHostConsoleTest(overrides, run) {
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
    ...overrides,
  });
  for (const name of ['LYNX_DELIVERY_UPLOAD_MODE', 'CLOUDFLARE_API_TOKEN', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
    if (!(name in overrides)) delete process.env[name];
  }
  try {
    run(host, environmentPath);
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
    Object.assign(process.env, saved);
  }
}

test('validates console setup from a host project, not this monorepo', () => {
  withHostConsoleTest({
    LYNX_DELIVERY_UPLOAD_MODE: 'r2',
    R2_ACCESS_KEY_ID: 'access-key',
    R2_SECRET_ACCESS_KEY: 'secret-key',
  }, (host, environmentPath) => {
    assert.doesNotThrow(() => setupConsole({ cwd: host, environmentPath, dryRun: true }));
  });
});

test('Wrangler-CLI uploads (the default) skip the R2 credential requirement', () => {
  withHostConsoleTest({ CLOUDFLARE_API_TOKEN: 'api-token' }, (host, environmentPath) => {
    assert.doesNotThrow(() => setupConsole({ cwd: host, environmentPath, dryRun: true }));
  });
});

test('Wrangler-CLI uploads (the default) still require a Cloudflare API token', () => {
  withHostConsoleTest({}, (host, environmentPath) => {
    assert.throws(
      () => setupConsole({ cwd: host, environmentPath, dryRun: true }),
      /CLOUDFLARE_API_TOKEN/,
    );
  });
});

test('direct-to-R2 uploads skip the Cloudflare API token requirement', () => {
  withHostConsoleTest({
    LYNX_DELIVERY_UPLOAD_MODE: 'r2',
    R2_ACCESS_KEY_ID: 'access-key',
    R2_SECRET_ACCESS_KEY: 'secret-key',
  }, (host, environmentPath) => {
    assert.doesNotThrow(() => setupConsole({ cwd: host, environmentPath, dryRun: true }));
  });
});

test('direct-to-R2 uploads still require R2 credentials', () => {
  withHostConsoleTest({ LYNX_DELIVERY_UPLOAD_MODE: 'r2' }, (host, environmentPath) => {
    assert.throws(
      () => setupConsole({ cwd: host, environmentPath, dryRun: true }),
      /R2_ACCESS_KEY_ID/,
    );
  });
});
