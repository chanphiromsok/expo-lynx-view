import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfigAsync, packRelease, signPayloadBytes } from '../packages/lynx-bundle-cli/src/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; };
const host = arg('--host', '0.0.0.0'), port = Number(arg('--port', '3000'));
const feature = arg('--feature', 'delivery'), channel = arg('--channel', 'stable');
const configPath = arg('--config', 'apps/expo-lynx-example/lynx-bundle.config.mjs');
const fault = arg('--fault', 'none');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Expected --port between 1 and 65535.');
if (!['none', '404', '500', 'corrupt-archive', 'invalid-signature', 'delay'].includes(fault)) throw new Error('Unsupported --fault mode.');
if (!['127.0.0.1', 'localhost'].includes(host)) console.warn(`Warning: binding development artifacts on ${host}; use only a trusted LAN.`);

const config = await loadConfigAsync({ configPath, cwd: root });
const releaseId = arg('--release-id', `${feature}-local-${Date.now()}`), version = arg('--version', `local-${Date.now()}`);
const packed = packRelease(config, { featureId: feature, releaseId, version, platform: 'ios', runtimeVersion: 'expo-57' });
const envelope = readFileSync(resolve(packed.outputDirectory, 'release-envelope.json'));
const archive = readFileSync(resolve(packed.outputDirectory, 'release.zip'));
const channelPayload = Buffer.from(`${JSON.stringify({ type: 'lynx-channel', feature, channel, revision: 1, releaseId, manifestUrl: `/v1/releases/${feature}/${releaseId}/manifest`, manifestSha256: createHash('sha256').update(envelope).digest('hex'), runtimeVersion: 'expo-57', activation: 'next-open', force: false, issuedAt: new Date().toISOString() })}\n`);
const channelEnvelope = Buffer.from(`${JSON.stringify(signPayloadBytes(channelPayload, 'lynx-channel', config.privateKeyPath))}\n`);

function send(request, response, bytes, type, cache) {
  const etag = `"${createHash('sha256').update(bytes).digest('hex')}"`;
  if (request.headers['if-none-match'] === etag) { response.writeHead(304, { ETag: etag, 'Cache-Control': cache }); response.end(); return; }
  response.writeHead(200, { ETag: etag, 'Cache-Control': cache, 'Content-Type': type, 'Content-Length': bytes.length });
  if (fault === 'delay') setTimeout(() => response.end(bytes), 1_500); else response.end(bytes);
}

const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (fault === '404') { response.writeHead(404); response.end('fault: 404'); return; }
  if (fault === '500') { response.writeHead(500); response.end('fault: 500'); return; }
  if (path === `/v1/channels/${feature}/${channel}`) return send(request, response, fault === 'invalid-signature' ? Buffer.concat([channelEnvelope, Buffer.from('x')]) : channelEnvelope, 'application/json; charset=utf-8', 'no-cache');
  // Compatibility alias for the current iOS managed-source property; it is
  // exactly the same signed bytes as the S03-shaped immutable release route.
  if (path === '/manifest.json' || path === `/v1/releases/${feature}/${releaseId}/manifest`) return send(request, response, fault === 'invalid-signature' ? Buffer.concat([envelope, Buffer.from('x')]) : envelope, 'application/json; charset=utf-8', 'public, max-age=31536000, immutable');
  if (path === '/release.zip' || path === `/v1/releases/${feature}/${releaseId}/release.zip`) { const bytes = fault === 'corrupt-archive' ? Buffer.from(archive.map((byte, index) => index ? byte : byte ^ 0xff)) : archive; return send(request, response, bytes, 'application/zip', 'public, max-age=31536000, immutable'); }
  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Not found');
});
server.listen(port, host, () => {
  const bases = Object.values(networkInterfaces()).flat().filter((entry) => entry?.family === 'IPv4' && !entry.internal).map((entry) => `http://${entry.address}:${port}`);
  console.log(`Release: ${feature}/${releaseId} (${packed.report.archiveSha256})`);
  console.log(`Simulator envelope: http://127.0.0.1:${port}/manifest.json`);
  for (const base of bases) console.log(`Device envelope:    ${base}/manifest.json`);
  console.log(`Channel route: /v1/channels/${feature}/${channel}`);
});
process.on('exit', () => { if (existsSync(packed.outputDirectory)) rmSync(packed.outputDirectory, { recursive: true, force: true }); });
