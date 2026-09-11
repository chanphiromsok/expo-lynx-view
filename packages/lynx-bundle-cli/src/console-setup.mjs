import { spawnSync } from 'node:child_process';
import { createPrivateKey, createPublicKey, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { configuredPublicKeyPath } from './signing-keys.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const placeholderDatabaseId = '00000000-0000-0000-0000-000000000000';

function run(command, args, cwd, { env, input } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env, input });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed.`);
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

function wranglerPath() {
  const manifestPath = require.resolve('wrangler/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.wrangler;
  if (!bin) throw new Error('The packaged Wrangler executable could not be found. Reinstall expo-lynx-bundle-cli.');
  return resolve(dirname(manifestPath), bin);
}

function runWrangler(args, cwd, options) {
  return run(process.execPath, [wranglerPath(), ...args], cwd, options);
}

function configured(value) {
  return Boolean(value && !value.startsWith('<'));
}

function required(value, name) {
  if (!configured(value)) throw new Error(`Missing ${name} in .env.lynx.`);
  return value;
}

function resource(value, name) {
  const result = required(value, name);
  if (/["\r\n]/.test(result)) throw new Error(`${name} has an extra quote or line break in .env.lynx. Use ${name}="your-name".`);
  return result;
}

function workerUploadsEnabled(environment) {
  return environment.LYNX_DELIVERY_WORKER_UPLOADS === 'true';
}

function credentials(username, password) {
  return {
    username: required(username, 'LYNX_CONSOLE_USERNAME'),
    password: required(password, 'LYNX_CONSOLE_PASSWORD'),
    apiKey: `lynx_live_${randomBytes(24).toString('base64url')}`,
    sessionSecret: randomBytes(32).toString('base64url'),
  };
}

function signingKey(cwd) {
  const publicPath = resolve(cwd, configuredPublicKeyPath(cwd));
  const privatePath = resolve(cwd, '.local-lynx-keys/updates.private.pem');
  if (!existsSync(publicPath)) throw new Error(`Missing mobile public key: ${publicPath}. Run \`lynx keys generate\` first.`);
  if (!existsSync(privatePath)) throw new Error(`Missing Worker private key: ${privatePath}. Run \`lynx keys generate\` first.`);
  const privatePem = readFileSync(privatePath, 'utf8');
  const privateKey = createPrivateKey(privatePem);
  if (privateKey.asymmetricKeyType !== 'rsa' || privateKey.asymmetricKeyDetails?.modulusLength !== 3072) {
    throw new Error('The Worker private key must be RSA-3072. Run `lynx keys generate` to create a compatible pair.');
  }
  const derived = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  const embedded = createPublicKey(readFileSync(publicPath, 'utf8')).export({ type: 'spki', format: 'der' });
  if (!derived.equals(embedded)) throw new Error('The local Worker private key does not match the public key embedded by the host app.');
  return privatePem;
}

function template() {
  const packaged = resolve(packageRoot, 'template');
  if (existsSync(resolve(packaged, 'worker.mjs'))) return packaged;
  const source = resolve(packageRoot, '../../apps/console');
  if (existsSync(resolve(source, 'worker/index.ts'))) {
    run('pnpm', ['--filter', 'expo-lynx-bundle-cli', 'prepare-template'], resolve(packageRoot, '../..'));
    return packaged;
  }
  throw new Error('The delivery Console template is missing. Reinstall expo-lynx-bundle-cli.');
}

function toml({ workerName, databaseName, databaseId, bucketName, templateRoot }) {
  return [
    `name = "${workerName}"`,
    `main = "${resolve(templateRoot, 'worker.mjs')}"`,
    'compatibility_date = "2026-08-28"',
    'workers_dev = true',
    '',
    '[assets]',
    `directory = "${resolve(templateRoot, 'assets')}"`,
    'not_found_handling = "single-page-application"',
    'run_worker_first = ["/__local-r2", "/__local-r2/*", "/api", "/api/*", "/health", "/v1", "/v1/*"]',
    '',
    '[[r2_buckets]]',
    `bucket_name = "${bucketName}"`,
    'binding = "ARTIFACTS"',
    '',
    '[[d1_databases]]',
    'binding = "DB"',
    `database_name = "${databaseName}"`,
    `database_id = "${databaseId}"`,
    `migrations_dir = "${resolve(templateRoot, 'migrations')}"`,
    '',
  ].join('\n');
}

function makeTemporaryConfig(values) {
  const directory = mkdtempSync(resolve(tmpdir(), 'lynx-delivery-'));
  const path = resolve(directory, 'wrangler.toml');
  writeFileSync(path, toml(values), { mode: 0o600 });
  return { directory, path };
}

function d1Id(path) {
  return readFileSync(path, 'utf8').match(/^database_id\s*=\s*"([^"]+)"/m)?.[1];
}

function existingD1Id(name, cwd, options) {
  const output = runWrangler(['d1', 'list', '--json'], cwd, options);
  const result = JSON.parse(output.slice(output.indexOf('['), output.lastIndexOf(']') + 1));
  const databases = Array.isArray(result) ? result : result.databases ?? result.result ?? [];
  const database = databases.find((entry) => entry.name === name);
  return database?.uuid ?? database?.id;
}

function deploymentUrl(output) {
  return output.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0];
}

function upsertEnvironment(path, values) {
  const original = readFileSync(path, 'utf8');
  let output = original.endsWith('\n') ? original : `${original}\n`;
  for (const [name, value] of Object.entries(values)) {
    const line = `${name}="${value.replaceAll('"', '\\"')}"`;
    const expression = new RegExp(`^${name}=.*$`, 'm');
    output = expression.test(output) ? output.replace(expression, line) : `${output}${line}\n`;
  }
  writeFileSync(path, output, { mode: 0o600 });
}

function temporaryEnvironment() {
  const environment = { ...process.env };
  delete environment.CLOUDFLARE_API_TOKEN;
  return environment;
}

export function listCloudflareAccounts(cwd = process.cwd()) {
  const environment = temporaryEnvironment();
  let result = spawnSync(process.execPath, [wranglerPath(), 'whoami', '--json'], { cwd, encoding: 'utf8', env: environment });
  if (result.error || result.status !== 0) {
    runWrangler(['login', '--scopes', 'account:read', 'user:read', 'd1:write', 'workers:write', 'workers_scripts:write'], cwd, { env: environment });
    result = spawnSync(process.execPath, [wranglerPath(), 'whoami', '--json'], { cwd, encoding: 'utf8', env: environment });
  }
  if (result.error || result.status !== 0) throw new Error('Could not list Cloudflare accounts from Wrangler login. Run `wrangler login` and try again.');
  const accounts = JSON.parse(result.stdout).accounts;
  const available = Array.isArray(accounts) ? accounts.map(({ id, name }) => ({ id, name })).filter(({ id, name }) => id && name) : [];
  if (available.length === 0) throw new Error('Your Wrangler login has no Cloudflare accounts.');
  return available;
}

function valuesFromEnvironment(environment) {
  return {
    workerName: resource(environment.LYNX_DELIVERY_WORKER_NAME, 'LYNX_DELIVERY_WORKER_NAME'),
    databaseName: resource(environment.LYNX_DELIVERY_D1_NAME, 'LYNX_DELIVERY_D1_NAME'),
    bucketName: resource(environment.LYNX_DELIVERY_R2_BUCKET, 'LYNX_DELIVERY_R2_BUCKET'),
    accountId: required(environment.CLOUDFLARE_ACCOUNT_ID, 'CLOUDFLARE_ACCOUNT_ID'),
    databaseId: configured(environment.LYNX_DELIVERY_D1_DATABASE_ID) ? environment.LYNX_DELIVERY_D1_DATABASE_ID : placeholderDatabaseId,
  };
}

export function setupConsole({ cwd = process.cwd(), environmentPath, dryRun = false } = {}) {
  const environment = process.env;
  const values = valuesFromEnvironment(environment);
  const key = signingKey(cwd);
  const admin = credentials(environment.LYNX_CONSOLE_USERNAME, environment.LYNX_CONSOLE_PASSWORD);
  const workerUploads = workerUploadsEnabled(environment);
  if (!workerUploads) {
    required(environment.R2_ACCESS_KEY_ID, 'R2_ACCESS_KEY_ID');
    required(environment.R2_SECRET_ACCESS_KEY, 'R2_SECRET_ACCESS_KEY');
  }
  if (!environmentPath) throw new Error('Missing .env.lynx. Run `lynx console setup` once to create it.');
  if (dryRun) {
    process.stdout.write(`Configuration is valid. Would create or reuse D1 ${values.databaseName}, R2 ${values.bucketName}, and deploy ${values.workerName}.\n`);
    process.stdout.write(workerUploads
      ? 'Uploads: Worker-proxied (LYNX_DELIVERY_WORKER_UPLOADS=true) — no R2 S3 credential needed by the release CLI.\n'
      : 'Uploads: direct to R2 with the configured R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY.\n');
    return;
  }

  const templateRoot = template();
  const temporary = makeTemporaryConfig({ ...values, templateRoot });
  const runOptions = { env: temporaryEnvironment() };
  try {
    if (values.databaseId === placeholderDatabaseId) {
      values.databaseId = existingD1Id(values.databaseName, cwd, runOptions);
      if (values.databaseId) process.stdout.write(`Using D1 ${values.databaseName} (${values.databaseId}).\n`);
      else {
        const output = runWrangler(['d1', 'create', values.databaseName, '--update-config', '--binding', 'DB', '--config', temporary.path], cwd, runOptions);
        values.databaseId = d1Id(temporary.path) ?? output.match(/database_id\s*=\s*"([^"]+)"/)?.[1];
      }
      if (!values.databaseId || values.databaseId === placeholderDatabaseId) throw new Error('Wrangler created D1 but did not return its database ID.');
      writeFileSync(temporary.path, toml({ ...values, templateRoot }), { mode: 0o600 });
    }
    const bucket = spawnSync(process.execPath, [wranglerPath(), 'r2', 'bucket', 'info', values.bucketName, '--config', temporary.path], { cwd, encoding: 'utf8', env: runOptions.env });
    if (bucket.status !== 0) runWrangler(['r2', 'bucket', 'create', values.bucketName, '--config', temporary.path], cwd, runOptions);
    const output = runWrangler(['deploy', '--config', temporary.path], cwd, runOptions);
    const url = deploymentUrl(output);
    if (!url) throw new Error('Worker deployed but Wrangler did not print a workers.dev URL.');
    for (const [name, value] of Object.entries({
      INITIAL_ADMIN_USERNAME: admin.username,
      INITIAL_ADMIN_PASSWORD: admin.password,
      INITIAL_ADMIN_API_KEY: admin.apiKey,
      AUTH_SESSION_SECRET: admin.sessionSecret,
      DELIVERY_SIGNING_PRIVATE_KEY: key,
      // Re-synced every run from LYNX_DELIVERY_WORKER_UPLOADS, so flipping
      // that value in .env.lynx and re-running setup toggles it live.
      WORKER_PROXIED_UPLOADS: workerUploads ? 'true' : 'false',
    })) runWrangler(['secret', 'put', name, '--config', temporary.path], cwd, { ...runOptions, input: value });
    runWrangler(['d1', 'migrations', 'apply', 'DB', '--remote', '--config', temporary.path], cwd, runOptions);
    upsertEnvironment(environmentPath, {
      CLOUDFLARE_ACCOUNT_ID: values.accountId,
      LYNX_DELIVERY_D1_DATABASE_ID: values.databaseId,
      LYNX_DELIVERY_SERVER: url,
      LYNX_DELIVERY_API_KEY: admin.apiKey,
    });
    process.stdout.write(workerUploads
      ? `Cloudflare delivery is ready: ${url}\nWorker-proxied uploads are on — \`lynx release\` needs no R2 credentials.\n`
      : `Cloudflare delivery is ready: ${url}\nSource .env.lynx before \`lynx release upload\`.\n`);
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
}

export function deployConsole({ cwd = process.cwd(), environmentPath } = {}) {
  const values = valuesFromEnvironment(process.env);
  if (values.databaseId === placeholderDatabaseId) throw new Error('Missing LYNX_DELIVERY_D1_DATABASE_ID in .env.lynx. Run `lynx console setup` first.');
  if (!environmentPath) throw new Error('Missing .env.lynx. Run `lynx console setup` first.');
  const temporary = makeTemporaryConfig({ ...values, templateRoot: template() });
  const runOptions = { env: temporaryEnvironment() };
  try {
    runWrangler(['deploy', '--config', temporary.path], cwd, runOptions);
    runWrangler(['d1', 'migrations', 'apply', 'DB', '--remote', '--config', temporary.path], cwd, runOptions);
  } finally {
    rmSync(temporary.directory, { recursive: true, force: true });
  }
}
