import { Command, Flags } from '@oclif/core';
import { existsSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import * as clack from '@clack/prompts';

import { listCloudflareAccounts, setupConsole, upsertEnvironment } from '../../console-setup.mjs';
import { loadNearestDeliveryEnvironment } from '../../env.mjs';
import { loadExpoConfig } from '../../expo-config.mjs';

// Every placeholder below (anything starting with "<") is filled in by an
// interactive prompt the next time `lynx console setup` runs — none of this
// needs to be hand-edited. Prompted values are written back here as they're
// answered, so a later run only asks about whatever is still unanswered.
const environmentTemplate = `# Lynx managed delivery. Keep this file private and out of Git.\n\n# Leave as a placeholder to choose a Cloudflare account interactively.\nCLOUDFLARE_ACCOUNT_ID="<select-during-setup>"\n\n# Cloudflare resource names for this host application's one delivery Console.\n# Leave as placeholders to be prompted for each, with a suggested name.\nLYNX_DELIVERY_WORKER_NAME="<your-worker-name>"\nLYNX_DELIVERY_D1_NAME="<your-d1-database-name>"\nLYNX_DELIVERY_R2_BUCKET="<your-r2-bucket-name>"\n\n# First user who can sign in to the delivery Console. Leave either value as\n# a placeholder (or delete the line) to be prompted for it interactively.\nLYNX_CONSOLE_USERNAME="<your-console-username>"\nLYNX_CONSOLE_PASSWORD="<choose-a-strong-password>"\n\n# How \`lynx release\` uploads release.zip — leave as a placeholder to choose\n# interactively. "wrangler" (recommended, same mechanism as hot-updater) asks\n# for a Cloudflare API token below; "r2" asks for an R2 S3 credential instead.\nLYNX_DELIVERY_UPLOAD_MODE="<select-during-setup>"\n\n# Only asked about when LYNX_DELIVERY_UPLOAD_MODE is "wrangler". In the\n# Cloudflare dashboard, under My Profile -> API Tokens, create a token with\n# Workers R2 Storage: Edit permission, then leave this as a placeholder to be\n# prompted for it.\nCLOUDFLARE_API_TOKEN="<your-cloudflare-api-token>"\n\n# Only asked about when LYNX_DELIVERY_UPLOAD_MODE is "r2". In the Cloudflare\n# dashboard, under R2 -> Manage R2 API Tokens, create an Object Read & Write\n# token scoped to LYNX_DELIVERY_R2_BUCKET, then leave these as placeholders\n# to be prompted for them.\nR2_ACCESS_KEY_ID="<your-r2-access-key-id>"\nR2_SECRET_ACCESS_KEY="<your-r2-secret-access-key>"\n\n# Written by \`lynx console setup\`. Do not edit these generated values.\nLYNX_DELIVERY_D1_DATABASE_ID=""\nLYNX_DELIVERY_SERVER=""\nLYNX_DELIVERY_API_KEY=""\n`;

// The Worker refuses a console password shorter than this for any account
// that isn't the local-dev admin/123456 default — see ensureInitialAdmin in
// apps/console/worker/auth.ts. Enforced here too so setup never gets all the
// way through provisioning only to have the first login rejected.
const minimumPasswordLength = 12;

function configured(value) {
  return Boolean(value && !value.startsWith('<'));
}

function cancelled(value) {
  if (!clack.isCancel(value)) return false;
  clack.cancel('Setup cancelled.');
  return true;
}

function ensureEnvironmentFile() {
  const existing = loadNearestDeliveryEnvironment();
  if (existing) return existing;
  const path = resolve(process.cwd(), '.env.lynx');
  if (!existsSync(path)) writeFileSync(path, environmentTemplate, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return path;
}

function slugify(value) {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** The host app's Expo slug/name, when one can be read — a far better
 * resource-name suggestion than the directory name alone. Setup only ever
 * uses this for a suggested default, so any failure to resolve it (no Expo
 * config, plugins that don't load without the app installed, ...) falls
 * back silently rather than blocking setup. */
function projectSlug(cwd) {
  try {
    const expo = loadExpoConfig(cwd);
    const candidate = expo?.slug || expo?.name;
    return typeof candidate === 'string' ? slugify(candidate) : undefined;
  } catch {
    return undefined;
  }
}

/** Prompts for the Cloudflare resource names when .env.lynx left them as
 * placeholders, suggesting a name derived from the host app's own Expo slug
 * (falling back to its directory name) so accepting the default usually
 * means just pressing enter. */
async function promptResourceNames(environmentPath) {
  const cwd = dirname(environmentPath);
  const base = projectSlug(cwd) || slugify(basename(cwd)) || 'lynx-delivery';
  const fields = [
    ['LYNX_DELIVERY_WORKER_NAME', 'Cloudflare Worker name', `${base}-delivery`],
    ['LYNX_DELIVERY_D1_NAME', 'D1 database name', `${base}-delivery`],
    ['LYNX_DELIVERY_R2_BUCKET', 'R2 bucket name', `${base}-delivery-artifacts`],
  ];
  for (const [name, label, suggestion] of fields) {
    if (configured(process.env[name])) continue;
    const value = await clack.text({
      message: `Choose a ${label}`,
      placeholder: suggestion,
      defaultValue: suggestion,
      // Empty input (pressing enter without typing) is valid here — clack
      // substitutes `defaultValue` for it once validation passes, so only
      // reject input that was actually typed but is blank (e.g. pasted
      // whitespace), not the absence of input.
      validate: (input) => (input.length > 0 && input.trim().length === 0 ? 'Enter a name.' : undefined),
    });
    if (cancelled(value)) return false;
    process.env[name] = value;
    upsertEnvironment(environmentPath, { [name]: value });
  }
  return true;
}

/** Prompts for how `lynx release` uploads release.zip when .env.lynx left it
 * as a placeholder. */
async function promptUploadMode(environmentPath) {
  if (configured(process.env.LYNX_DELIVERY_UPLOAD_MODE)) return true;
  const choice = await clack.select({
    message: 'How should `lynx release` upload release.zip?',
    options: [
      { value: 'wrangler', label: 'Wrangler CLI', hint: 'recommended — same mechanism as hot-updater' },
      { value: 'r2', label: 'Direct to R2', hint: 'needs an R2 S3 access key' },
    ],
    initialValue: 'wrangler',
  });
  if (cancelled(choice)) return false;
  process.env.LYNX_DELIVERY_UPLOAD_MODE = choice;
  upsertEnvironment(environmentPath, { LYNX_DELIVERY_UPLOAD_MODE: choice });
  return true;
}

/** Prompts for a Cloudflare API token when Wrangler-CLI uploads were chosen
 * and .env.lynx left it as a placeholder. */
async function promptCloudflareApiToken(environmentPath) {
  if (configured(process.env.CLOUDFLARE_API_TOKEN)) return true;
  const token = await clack.password({
    message: 'Cloudflare API token (Workers R2 Storage: Edit permission)',
    validate: (value) => (value.trim().length === 0 ? 'Enter an API token.' : undefined),
  });
  if (cancelled(token)) return false;
  process.env.CLOUDFLARE_API_TOKEN = token;
  upsertEnvironment(environmentPath, { CLOUDFLARE_API_TOKEN: token });
  return true;
}

/** Prompts for an R2 S3 credential when direct-to-R2 uploads were chosen and
 * .env.lynx left either half of it as a placeholder. */
async function promptR2Credentials(environmentPath) {
  if (!configured(process.env.R2_ACCESS_KEY_ID)) {
    const accessKeyId = await clack.text({
      message: 'R2 access key ID',
      validate: (value) => (value.trim().length === 0 ? 'Enter an access key ID.' : undefined),
    });
    if (cancelled(accessKeyId)) return false;
    process.env.R2_ACCESS_KEY_ID = accessKeyId;
    upsertEnvironment(environmentPath, { R2_ACCESS_KEY_ID: accessKeyId });
  }
  if (!configured(process.env.R2_SECRET_ACCESS_KEY)) {
    const secretAccessKey = await clack.password({
      message: 'R2 secret access key',
      validate: (value) => (value.trim().length === 0 ? 'Enter a secret access key.' : undefined),
    });
    if (cancelled(secretAccessKey)) return false;
    process.env.R2_SECRET_ACCESS_KEY = secretAccessKey;
    upsertEnvironment(environmentPath, { R2_SECRET_ACCESS_KEY: secretAccessKey });
  }
  return true;
}

/** Prompts for the Console's first username/password when .env.lynx left
 * either as a placeholder, persisting whatever is entered back into that
 * file so re-running setup later doesn't ask again. */
async function promptConsoleCredentials(environmentPath) {
  if (!configured(process.env.LYNX_CONSOLE_USERNAME)) {
    const username = await clack.text({
      message: 'Choose a username for the delivery Console',
      placeholder: 'operator',
      validate: (value) => (value.trim().length === 0 ? 'Enter a username.' : undefined),
    });
    if (cancelled(username)) return false;
    process.env.LYNX_CONSOLE_USERNAME = username;
    upsertEnvironment(environmentPath, { LYNX_CONSOLE_USERNAME: username });
  }
  if (!configured(process.env.LYNX_CONSOLE_PASSWORD)) {
    const password = await clack.password({
      message: 'Choose a password for the delivery Console',
      validate: (value) => (value.length < minimumPasswordLength ? `Use at least ${minimumPasswordLength} characters.` : undefined),
    });
    if (cancelled(password)) return false;
    process.env.LYNX_CONSOLE_PASSWORD = password;
    upsertEnvironment(environmentPath, { LYNX_CONSOLE_PASSWORD: password });
  }
  return true;
}

async function selectAccount() {
  const spinner = clack.spinner();
  spinner.start('Loading Cloudflare accounts');
  const accounts = listCloudflareAccounts();
  spinner.stop('Cloudflare accounts loaded');
  const selected = await clack.select({
    message: 'Select a Cloudflare account',
    options: accounts.map(({ id, name }) => ({ value: id, label: name, hint: id })),
  });
  if (cancelled(selected)) return null;
  return selected;
}

export async function runConsoleSetup(flags) {
  clack.intro('Lynx managed delivery — Console setup');
  const environmentPath = ensureEnvironmentFile();
  if (!(await promptResourceNames(environmentPath))) {
    process.exitCode = 1;
    return;
  }
  if (!(await promptUploadMode(environmentPath))) {
    process.exitCode = 1;
    return;
  }
  const mode = process.env.LYNX_DELIVERY_UPLOAD_MODE;
  const modePrompted = mode === 'r2'
    ? await promptR2Credentials(environmentPath)
    : await promptCloudflareApiToken(environmentPath);
  if (!modePrompted) {
    process.exitCode = 1;
    return;
  }
  if (!(await promptConsoleCredentials(environmentPath))) {
    process.exitCode = 1;
    return;
  }
  if (!configured(process.env.CLOUDFLARE_ACCOUNT_ID)) {
    const accountId = await selectAccount();
    if (!accountId) {
      process.exitCode = 1;
      return;
    }
    process.env.CLOUDFLARE_ACCOUNT_ID = accountId;
  }
  setupConsole({
    dryRun: flags['dry-run'],
    environmentPath,
  });
  clack.outro(flags['dry-run'] ? 'Configuration is valid.' : 'Console is ready.');
}

export default class ConsoleSetup extends Command {
  static description = 'Provision D1, R2, Worker secrets, and a deployed delivery Console.';

  static flags = { 'dry-run': Flags.boolean({ description: 'validate .env.lynx without Cloudflare changes' }) };

  async run() {
    const { flags } = await this.parse(ConsoleSetup);
    await runConsoleSetup(flags);
  }
}
