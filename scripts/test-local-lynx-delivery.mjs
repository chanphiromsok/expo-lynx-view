#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { generateKeys, signPayloadBytes } from '../packages/lynx-bundle-cli/src/index.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const deliveryCli = resolve(repositoryRoot, 'scripts/local-lynx-delivery.mjs');
const temporary = mkdtempSync(resolve(tmpdir(), 'expo-lynx-delivery-test-'));
let server;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function reservePort() {
  const probe = createServer();
  await new Promise((resolveListen, rejectListen) => {
    probe.once('error', rejectListen);
    probe.listen(0, '127.0.0.1', resolveListen);
  });
  const port = probe.address().port;
  await new Promise((resolveClose) => probe.close(resolveClose));
  return port;
}

function run(command, argumentsList, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, argumentsList, { cwd: repositoryRoot, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', rejectRun);
    child.once('exit', (code) => {
      if (code === 0) resolveRun({ stdout, stderr });
      else rejectRun(new Error(`${command} exited ${code}: ${stderr || stdout}`));
    });
  });
}

async function startServer(argumentsList) {
  server = spawn(process.execPath, [deliveryCli, 'serve', ...argumentsList], { cwd: repositoryRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  server.stdout.on('data', (chunk) => { stdout += chunk; });
  server.stderr.on('data', (chunk) => { stderr += chunk; });
  const ready = await Promise.race([
    new Promise((resolveReady, rejectReady) => {
      const check = () => {
        const match = stdout.match(/Local Lynx delivery ready: (http:\/\/[^\s]+)/);
        if (match) resolveReady(match[1]);
      };
      server.stdout.on('data', check);
      server.once('error', rejectReady);
      server.once('exit', (code) => rejectReady(new Error(`delivery server exited ${code}: ${stderr || stdout}`)));
    }),
    new Promise((_, rejectTimeout) => setTimeout(() => rejectTimeout(new Error(`Timed out starting local delivery server: ${stderr || stdout}`)), 5_000)),
  ]);
  return ready;
}

async function main() {
  const keys = generateKeys(resolve(temporary, 'keys'));
  const releaseDirectory = resolve(temporary, 'release');
  const archive = Buffer.from('not-a-real-zip: route contract fixture');
  const main = Buffer.from('fixture Lynx bundle');
  const payload = {
    type: 'lynx-release',
    feature: 'delivery',
    releaseId: 'delivery-local-test-1',
    version: 'local-test-1',
    platform: 'ios',
    compatibility: { runtimeVersion: 'expo-57', minHostVersion: '1.0.0', lynxEngineVersion: '4.0.0' },
    archive: { format: 'zip', url: 'release.zip', sha256: sha256(archive), bytes: archive.byteLength, uncompressedBytes: main.byteLength, entryCount: 1 },
    files: [{ path: 'main.lynx.bundle', bytes: main.byteLength, sha256: sha256(main) }],
  };
  const payloadBytes = Buffer.from(`${JSON.stringify(payload)}\n`);
  const envelope = Buffer.from(`${JSON.stringify(signPayloadBytes(payloadBytes, 'lynx-release', keys.privateKeyPath))}\n`);
  writeFileSync(resolve(releaseDirectory, '../release-envelope.json'), envelope, { mode: 0o600 });
  writeFileSync(resolve(releaseDirectory, '../release.zip'), archive, { mode: 0o600 });
  const port = await reservePort();
  const token = 'local-test-publisher-token';
  const base = await startServer([
    '--host', '127.0.0.1', '--port', String(port), '--token', token,
    '--private-key', keys.privateKeyPath, '--public-key', keys.publicKeyPath,
    '--storage-dir', resolve(temporary, 'storage'),
  ]);

  const unauthorized = await fetch(`${base}/v1/admin/releases/delivery/delivery-local-test-1/manifest`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: envelope,
  });
  assert.equal(unauthorized.status, 401, 'operator uploads require a token before accepting a body');

  const published = await run(process.execPath, [deliveryCli, 'publish', '--server', base, '--token', token, '--release-dir', temporary, '--channel', 'stable']);
  assert.match(published.stdout, /"status": "published"/);
  const repeated = await run(process.execPath, [deliveryCli, 'publish', '--server', base, '--token', token, '--release-dir', temporary, '--channel', 'stable']);
  assert.match(repeated.stdout, /"revision": 1/);

  const channel = await fetch(`${base}/v1/channels/delivery/stable`);
  assert.equal(channel.status, 200);
  assert.equal(channel.headers.get('cache-control'), 'no-cache');
  const channelEtag = channel.headers.get('etag');
  assert.ok(channelEtag);
  assert.equal((await fetch(`${base}/v1/channels/delivery/stable`, { headers: { 'If-None-Match': channelEtag } })).status, 304);

  const manifest = await fetch(`${base}/v1/releases/delivery/delivery-local-test-1/manifest`);
  assert.equal(manifest.status, 200);
  assert.equal(manifest.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.deepEqual(Buffer.from(await manifest.arrayBuffer()), envelope);
  const downloadedArchive = await fetch(`${base}/v1/releases/delivery/delivery-local-test-1/release.zip`);
  assert.equal(downloadedArchive.status, 200);
  assert.equal(downloadedArchive.headers.get('content-type'), 'application/zip');
  assert.deepEqual(Buffer.from(await downloadedArchive.arrayBuffer()), archive);

  process.stdout.write('local Lynx delivery integration test passed\n');
}

main().finally(() => {
  if (server && !server.killed) server.kill('SIGTERM');
  rmSync(temporary, { recursive: true, force: true });
}).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
