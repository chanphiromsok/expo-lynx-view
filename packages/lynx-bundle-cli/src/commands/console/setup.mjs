import { Command, Flags } from '@oclif/core';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { listCloudflareAccounts, setupConsole } from '../../console-setup.mjs';
import { loadNearestDeliveryEnvironment } from '../../env.mjs';

const environmentTemplate = `# Lynx managed delivery. Keep this file private and out of Git.\n\n# Optional: leave as a placeholder to choose a Cloudflare account in your browser.\nCLOUDFLARE_ACCOUNT_ID="<select-during-setup>"\n\n# Cloudflare resource names for this host application's one delivery Console.\nLYNX_DELIVERY_WORKER_NAME="<your-worker-name>"\nLYNX_DELIVERY_D1_NAME="<your-d1-database-name>"\nLYNX_DELIVERY_R2_BUCKET="<your-r2-bucket-name>"\n\n# First user who can sign in to the delivery Console.\nLYNX_CONSOLE_USERNAME="<your-console-username>"\nLYNX_CONSOLE_PASSWORD="<choose-a-strong-password>"\n\n# How \`lynx release\` uploads release.zip. Pick one:\n#\n# "true"  - Worker-proxied. The Worker writes to R2 itself; the release CLI\n#           never needs an R2 S3 credential. The Worker gains R2 write\n#           access as the tradeoff. Leave R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY\n#           below unset.\n# "false" - Direct to R2 (default). The release CLI uploads with its own R2\n#           S3 credential below; the Worker never receives R2 write access.\nLYNX_DELIVERY_WORKER_UPLOADS="false"\n\n# Required only when LYNX_DELIVERY_WORKER_UPLOADS is "false". In the\n# Cloudflare dashboard, under R2 -> Manage R2 API Tokens, create an Object\n# Read & Write token scoped to LYNX_DELIVERY_R2_BUCKET.\nR2_ACCESS_KEY_ID="<your-r2-access-key-id>"\nR2_SECRET_ACCESS_KEY="<your-r2-secret-access-key>"\n\n# Written by \`lynx console setup\`. Do not edit these generated values.\nLYNX_DELIVERY_D1_DATABASE_ID=""\nLYNX_DELIVERY_SERVER=""\nLYNX_DELIVERY_API_KEY=""\n`;

function configured(value) {
  return Boolean(value && !value.startsWith('<'));
}

async function prompt(question) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await terminal.question(question)).trim();
  } finally {
    terminal.close();
  }
}

function ensureEnvironmentFile() {
  const existing = loadNearestDeliveryEnvironment();
  if (existing) return existing;
  const path = resolve(process.cwd(), '.env.lynx');
  if (!existsSync(path)) writeFileSync(path, environmentTemplate, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  throw new Error(`Created ${path}. Fill its placeholders, then run \`lynx console setup\` again.`);
}

async function selectAccount() {
  const accounts = listCloudflareAccounts();
  process.stdout.write('Account List\n');
  accounts.forEach(({ name, id }, index) => process.stdout.write(`${index + 1}) ${name} (${id})\n`));
  const selected = await prompt(`Select account [1-${accounts.length}]: `);
  const index = Number(selected) - 1;
  if (!Number.isInteger(index) || !accounts[index]) throw new Error('Select one listed Cloudflare account.');
  return accounts[index].id;
}

export async function runConsoleSetup(flags) {
  const environmentPath = ensureEnvironmentFile();
  const workerUploads = process.env.LYNX_DELIVERY_WORKER_UPLOADS === 'true';
  const missing = [
    'LYNX_DELIVERY_WORKER_NAME',
    'LYNX_DELIVERY_D1_NAME',
    'LYNX_DELIVERY_R2_BUCKET',
    'LYNX_CONSOLE_USERNAME',
    'LYNX_CONSOLE_PASSWORD',
    ...(workerUploads ? [] : ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']),
  ].filter((name) => !configured(process.env[name]));
  if (missing.length > 0) {
    throw new Error(`Missing ${missing.join(', ')} in .env.lynx.`);
  }
  const accountId = configured(process.env.CLOUDFLARE_ACCOUNT_ID)
    ? process.env.CLOUDFLARE_ACCOUNT_ID
    : await selectAccount();
  process.env.CLOUDFLARE_ACCOUNT_ID = accountId;
  setupConsole({
    dryRun: flags['dry-run'],
    environmentPath,
  });
}

export default class ConsoleSetup extends Command {
  static description = 'Provision D1, R2, Worker secrets, and a deployed delivery Console.';

  static flags = { 'dry-run': Flags.boolean({ description: 'validate .env.lynx without Cloudflare changes' }) };

  async run() {
    const { flags } = await this.parse(ConsoleSetup);
    await runConsoleSetup(flags);
  }
}
