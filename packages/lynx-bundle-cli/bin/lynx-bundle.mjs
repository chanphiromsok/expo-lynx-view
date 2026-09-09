#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildEmbedded,
  buildFeature,
  checkEmbedded,
  loadConfigAsync,
  packRelease,
} from '../src/index.mjs';
import { generateSigningKeyPair } from '../src/signing-keys.mjs';

const [command, ...argumentsList] = process.argv.slice(2);

function option(name, fallback) {
  const index = argumentsList.indexOf(name);
  return index === -1 ? fallback : argumentsList[index + 1];
}

function positional() {
  const values = [];
  for (let index = 0; index < argumentsList.length; index += 1) {
    if (argumentsList[index].startsWith('--')) index += 1;
    else values.push(argumentsList[index]);
  }
  return values;
}

function writeResult(value, output) {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  if (output) writeFileSync(resolve(output), bytes, { mode: 0o600 });
  else process.stdout.write(bytes);
}

function required(value, name) {
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function main() {
  if (!command || command === '--help') {
    process.stdout.write(`Usage:\n  lynx-bundle keys generate --output-dir directory\n  lynx-bundle build <feature> [--config file]\n  lynx-bundle build-embedded [feature...] [--config file]\n  lynx-bundle check-embedded [--config file]\n  lynx-bundle pack <feature> --release-id id --version version [--config file]\n`);
    return;
  }
  if (command === 'keys' && positional()[0] === 'generate') {
    const outputDirectory = required(option('--output-dir'), '--output-dir');
    writeResult(generateSigningKeyPair({
      publicKeyPath: resolve(outputDirectory, 'updates.public.pem'),
      privateKeyPath: resolve(outputDirectory, 'updates.private.pem'),
    }), option('--output'));
    return;
  }
  const config = await loadConfigAsync({ configPath: option('--config') });
  if (command === 'build') {
    const feature = required(positional()[0], 'feature');
    writeResult(buildFeature(config, feature), option('--output'));
    return;
  }
  if (command === 'build-embedded') {
    const features = positional();
    writeResult(buildEmbedded(config, features), option('--output'));
    return;
  }
  if (command === 'check-embedded') {
    writeResult(checkEmbedded(config), option('--output'));
    return;
  }
  if (command === 'pack') {
    const featureId = required(positional()[0], 'feature');
    writeResult(packRelease(config, {
      featureId,
      releaseId: required(option('--release-id'), '--release-id'),
      version: required(option('--version'), '--version'),
    }), option('--output'));
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
