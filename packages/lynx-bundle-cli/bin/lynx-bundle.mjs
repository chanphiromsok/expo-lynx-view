#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildEmbedded,
  buildFeature,
  checkEmbedded,
  generateKeys,
  loadConfigAsync,
  packRelease,
  signPayloadFile,
} from '../src/index.mjs';

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
    process.stdout.write(`Usage:\n  lynx-bundle build <feature> [--config file]\n  lynx-bundle build-embedded [feature...] --runtime-version version [--config file]\n  lynx-bundle check-embedded --runtime-version version [--config file]\n  lynx-bundle pack <feature> --release-id id --version version --platform ios --runtime-version version [--config file]\n  lynx-bundle keys generate --output-dir directory\n  lynx-bundle sign-release payload.json [--config file] [--output file]\n  lynx-bundle sign-channel payload.json [--config file] [--output file]\n`);
    return;
  }
  if (command === 'keys' && argumentsList[0] === 'generate') {
    writeResult(generateKeys(required(option('--output-dir'), '--output-dir')), option('--output'));
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
    writeResult(buildEmbedded(config, features, required(option('--runtime-version'), '--runtime-version')), option('--output'));
    return;
  }
  if (command === 'check-embedded') {
    writeResult(checkEmbedded(config, required(option('--runtime-version'), '--runtime-version')), option('--output'));
    return;
  }
  if (command === 'pack') {
    const featureId = required(positional()[0], 'feature');
    writeResult(packRelease(config, {
      featureId,
      releaseId: required(option('--release-id'), '--release-id'),
      version: required(option('--version'), '--version'),
      platform: required(option('--platform'), '--platform'),
      runtimeVersion: required(option('--runtime-version'), '--runtime-version'),
      minHostVersion: option('--min-host-version', '1.0.0'),
      lynxEngineVersion: option('--lynx-engine-version', '4.0.0'),
    }), option('--output'));
    return;
  }
  if (command === 'sign-release' || command === 'sign-channel') {
    writeResult(signPayloadFile(config, required(positional()[0], 'payload path'), command === 'sign-release' ? 'lynx-release' : 'lynx-channel'), option('--output'));
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
