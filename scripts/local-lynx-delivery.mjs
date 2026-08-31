#!/usr/bin/env node

/**
 * Persistent, production-shaped local delivery service for iOS integration
 * testing. It deliberately has no Cloudflare dependencies: files are stored
 * under an ignored directory, but public and operator routes mirror the V2
 * Worker contract. Never deploy this process as the production service.
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { dirname, resolve } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

import { PROTOCOL_LIMITS, signPayloadBytes, verifyEnvelope } from '../packages/lynx-bundle-cli/src/index.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_ADMIN_JSON_BYTES = 64 * 1024;
const FEATURE_ID = /^[a-z][a-z0-9-]{0,63}$/;
const RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA_256 = /^[a-f0-9]{64}$/;

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function usage() {
  process.stdout.write(`Usage:
  lynx-delivery serve --token <publisher-token> --private-key <PKCS#8.pem> --public-key <SPKI.pem> [--host 0.0.0.0] [--port 3000] [--storage-dir .local-lynx-delivery]
  lynx-delivery publish --server <base-url> --token <publisher-token> --release-dir <directory> [--activation next-open|on-launch] [--force]
  lynx-delivery promote --server <base-url> --token <publisher-token> --feature <feature> --release-id <release-id> [--activation next-open|on-launch] [--force]

Public routes:
  GET /v1/channels/:feature/:channel
  GET /v1/releases/:feature/:releaseId/manifest
  GET /v1/releases/:feature/:releaseId/release.zip

Operator routes (Bearer token required):
  PUT  /v1/admin/releases/:feature/:releaseId/manifest
  PUT  /v1/admin/releases/:feature/:releaseId/archive
  POST /v1/admin/channels/:feature/:channel/promote
`);
}

function args(values) {
  const result = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) throw new Error(`Unexpected argument: ${value}`);
    if (value === '--force') {
      result.set(value, true);
      continue;
    }
    const next = values[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`${value} requires a value.`);
    result.set(value, next);
    index += 1;
  }
  return result;
}

function required(value, name) {
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function safeFeature(value) {
  if (typeof value !== 'string' || !FEATURE_ID.test(value)) throw new HttpError(400, 'invalid-feature', 'Feature is invalid.');
  return value;
}

function safeChannel(value) {
  if (value !== 'active') throw new HttpError(400, 'invalid-channel', 'Only the active deployment is supported.');
  return value;
}

function safeRelease(value) {
  if (typeof value !== 'string' || !RELEASE_ID.test(value)) throw new HttpError(400, 'invalid-release', 'Release ID is invalid.');
  return value;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function strongEtag(bytes) {
  return `"${sha256(bytes)}"`;
}

function releaseKey(feature, releaseId) {
  return `${feature}/${releaseId}`;
}

function channelKey(feature, channel) {
  return `${feature}/${channel}`;
}

function releaseDirectory(root, feature, releaseId) {
  return resolve(root, 'releases', feature, releaseId);
}

function uploadDirectory(root, feature, releaseId) {
  return resolve(root, 'uploads', feature, releaseId);
}

function atomicWrite(path, bytes) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = resolve(dirname(path), `.${randomUUID()}.part`);
  writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, path);
}

function loadState(root) {
  const path = resolve(root, 'state.json');
  if (!existsSync(path)) return { schemaVersion: 1, releases: {}, channels: {}, idempotency: {} };
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`Local delivery state is unreadable: ${path}`);
  }
  if (value?.schemaVersion !== 1 || !isObject(value.releases) || !isObject(value.channels) || !isObject(value.idempotency)) {
    throw new Error(`Local delivery state has an unsupported shape: ${path}`);
  }
  return value;
}

function saveState(root, state) {
  atomicWrite(resolve(root, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseReleaseEnvelope(bytes, expectedFeature, expectedReleaseId, publicKeyPath) {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_MANIFEST_BYTES) {
    throw new HttpError(413, 'manifest-too-large', 'Release manifest exceeds the allowed size.');
  }
  let envelope;
  try {
    envelope = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid-manifest', 'Release manifest is not valid JSON.');
  }
  if (!verifyEnvelope(envelope, publicKeyPath)) {
    throw new HttpError(422, 'invalid-signature', 'Release manifest signature is invalid.');
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(envelope.payload, 'base64url').toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid-payload', 'Release manifest payload is not valid JSON.');
  }
  if (!isObject(payload) || payload.type !== 'lynx-release') {
    throw new HttpError(422, 'invalid-payload', 'Expected a lynx-release payload.');
  }
  if (payload.feature !== expectedFeature || payload.releaseId !== expectedReleaseId) {
    throw new HttpError(422, 'identity-mismatch', 'Release manifest identity does not match the upload route.');
  }
  if (payload.platform !== 'ios' || !isObject(payload.compatibility) || typeof payload.compatibility.runtimeVersion !== 'string' || !payload.compatibility.runtimeVersion) {
    throw new HttpError(422, 'invalid-compatibility', 'Release manifest has unsupported compatibility metadata.');
  }
  if (!isObject(payload.archive) || payload.archive.format !== 'zip' || payload.archive.url !== 'release.zip' || !SHA_256.test(payload.archive.sha256 ?? '') || !Number.isSafeInteger(payload.archive.bytes) || payload.archive.bytes <= 0 || payload.archive.bytes > PROTOCOL_LIMITS.maxArchiveBytes) {
    throw new HttpError(422, 'invalid-archive', 'Release manifest has invalid archive metadata.');
  }
  if (!Array.isArray(payload.files) || payload.files.length === 0 || payload.files.length > PROTOCOL_LIMITS.maxEntries || !payload.files.some((file) => file?.path === 'main.lynx.bundle')) {
    throw new HttpError(422, 'invalid-files', 'Release manifest does not declare a valid Lynx file set.');
  }
  return {
    envelopeSha256: sha256(bytes),
    archiveSha256: payload.archive.sha256,
    archiveBytes: payload.archive.bytes,
    runtimeVersion: payload.compatibility.runtimeVersion,
    version: typeof payload.version === 'string' ? payload.version : '',
  };
}

function requestBodyLimit(request, maximum) {
  const advertised = Number(request.headers['content-length']);
  if (Number.isFinite(advertised) && (advertised < 0 || advertised > maximum)) {
    throw new HttpError(413, 'body-too-large', 'Request body exceeds the allowed size.');
  }
}

async function readBody(request, maximum) {
  requestBodyLimit(request, maximum);
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maximum) throw new HttpError(413, 'body-too-large', 'Request body exceeds the allowed size.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

async function writeArchive(request, path, maximum) {
  requestBodyLimit(request, maximum);
  const hash = createHash('sha256');
  let bytes = 0;
  const guard = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maximum) {
        callback(new HttpError(413, 'archive-too-large', 'Archive exceeds the allowed size.'));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(request, guard, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
    return { bytes, sha256: hash.digest('hex') };
  } catch (error) {
    rmSync(path, { force: true });
    throw error;
  }
}

function sendJson(response, status, value, headers = {}) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': bytes.byteLength,
    'Cache-Control': 'no-store',
    ...headers,
  });
  response.end(bytes);
}

function sendError(response, error) {
  const status = error instanceof HttpError ? error.status : 500;
  const code = error instanceof HttpError ? error.code : 'internal-error';
  const message = error instanceof HttpError ? error.message : 'Internal server error.';
  sendJson(response, status, { error: { code, message } });
}

function matchesEtag(request, etag) {
  return request.headers['if-none-match'] === etag;
}

function sendBytes(request, response, bytes, contentType, cacheControl) {
  const etag = strongEtag(bytes);
  if (matchesEtag(request, etag)) {
    response.writeHead(304, { ETag: etag, 'Cache-Control': cacheControl });
    response.end();
    return;
  }
  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': bytes.byteLength,
    'Cache-Control': cacheControl,
    ETag: etag,
  });
  response.end(bytes);
}

function sendFile(request, response, path, contentType, cacheControl, expectedSha256) {
  const bytes = readFileSync(path);
  if (sha256(bytes) !== expectedSha256) throw new HttpError(503, 'artifact-unavailable', 'Release artifact is unavailable.');
  sendBytes(request, response, bytes, contentType, cacheControl);
}

function authorized(request, token) {
  const value = request.headers.authorization;
  if (typeof value !== 'string' || !value.startsWith('Bearer ')) return false;
  const presented = Buffer.from(value.slice('Bearer '.length));
  const expected = Buffer.from(token);
  return presented.byteLength === expected.byteLength && timingSafeEqual(presented, expected);
}

function requireOperator(request, token) {
  if (!authorized(request, token)) throw new HttpError(401, 'unauthorized', 'A valid publisher token is required.');
}

function parseOperatorJson(bytes) {
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (!isObject(value)) throw new Error('not object');
    return value;
  } catch {
    throw new HttpError(400, 'invalid-json', 'Operator request must be a JSON object.');
  }
}

function activation(value) {
  const selected = value ?? 'next-open';
  if (selected !== 'next-open' && selected !== 'on-launch') throw new HttpError(400, 'invalid-activation', 'Activation must be next-open or on-launch.');
  return selected;
}

function createMutationQueue() {
  let tail = Promise.resolve();
  return (work) => {
    const result = tail.then(work, work);
    tail = result.catch(() => undefined);
    return result;
  };
}

function routeParts(pathname) {
  return pathname.split('/').filter(Boolean);
}

async function serve(options) {
  const root = resolve(repositoryRoot, options.storageDir);
  const privateKeyPath = resolve(repositoryRoot, options.privateKey);
  const publicKeyPath = resolve(repositoryRoot, options.publicKey);
  const token = options.token;
  if (!existsSync(privateKeyPath) || !existsSync(publicKeyPath)) throw new Error('Both --private-key and --public-key must point to existing PEM files.');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const probePayload = Buffer.from('{"type":"lynx-channel","feature":"probe","channel":"active"}\n');
  if (!verifyEnvelope(signPayloadBytes(probePayload, 'lynx-channel', privateKeyPath), publicKeyPath)) {
    throw new Error('The configured private and public PEM keys are not a matching RSA signing pair.');
  }
  loadState(root);
  const mutate = createMutationQueue();

  const server = createServer(async (request, response) => {
    try {
      const method = request.method ?? 'GET';
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      const parts = routeParts(pathname);

      if (method === 'GET' && pathname === '/health') {
        sendJson(response, 200, { ok: true, service: 'local-lynx-delivery', storage: 'local-persistent' });
        return;
      }

      if (method === 'GET' && parts[0] === 'v1' && parts[1] === 'channels' && parts.length === 4) {
        const feature = safeFeature(parts[2]);
        const channel = safeChannel(parts[3]);
        const record = loadState(root).channels[channelKey(feature, channel)];
        if (!record) throw new HttpError(404, 'not-found', 'Channel was not found.');
        sendBytes(request, response, Buffer.from(record.envelope, 'base64'), 'application/json; charset=utf-8', 'no-cache');
        return;
      }

      if (method === 'GET' && parts[0] === 'v1' && parts[1] === 'releases' && parts.length === 5) {
        const feature = safeFeature(parts[2]);
        const releaseId = safeRelease(parts[3]);
        const kind = parts[4];
        const record = loadState(root).releases[releaseKey(feature, releaseId)];
        if (!record || record.status !== 'ready') throw new HttpError(404, 'not-found', 'Release was not found.');
        const directory = releaseDirectory(root, feature, releaseId);
        if (kind === 'manifest') {
          sendFile(request, response, resolve(directory, 'manifest.json'), 'application/json; charset=utf-8', 'public, max-age=31536000, immutable', record.manifestSha256);
          return;
        }
        if (kind === 'release.zip') {
          sendFile(request, response, resolve(directory, 'release.zip'), 'application/zip', 'public, max-age=31536000, immutable', record.archiveSha256);
          return;
        }
      }

      // The explicit branches below use /v1/admin/releases/:feature/:releaseId/manifest
      // and /archive. Keeping route matching manual makes every path segment checked
      // before it can influence storage paths.
      if (method === 'PUT' && parts[0] === 'v1' && parts[1] === 'admin' && parts[2] === 'releases' && parts.length === 6 && parts[5] === 'manifest') {
        requireOperator(request, token);
        const feature = safeFeature(parts[3]);
        const releaseId = safeRelease(parts[4]);
        const bytes = await readBody(request, MAX_MANIFEST_BYTES);
        const metadata = parseReleaseEnvelope(bytes, feature, releaseId, publicKeyPath);
        const result = await mutate(() => {
          const state = loadState(root);
          const key = releaseKey(feature, releaseId);
          const current = state.releases[key];
          if (current?.status === 'ready') {
            if (current.manifestSha256 === metadata.envelopeSha256) return { status: 200, value: { status: 'ready', idempotent: true, feature, releaseId } };
            throw new HttpError(409, 'release-conflict', 'Release ID already refers to immutable content.');
          }
          if (current && current.manifestSha256 !== metadata.envelopeSha256) throw new HttpError(409, 'release-conflict', 'Release ID already has different upload content.');
          const directory = uploadDirectory(root, feature, releaseId);
          mkdirSync(directory, { recursive: true, mode: 0o700 });
          atomicWrite(resolve(directory, 'manifest.json'), bytes);
          state.releases[key] = { status: 'uploading', feature, releaseId, manifestSha256: metadata.envelopeSha256, archiveSha256: metadata.archiveSha256, archiveBytes: metadata.archiveBytes, runtimeVersion: metadata.runtimeVersion, version: metadata.version, createdAt: current?.createdAt ?? new Date().toISOString() };
          saveState(root, state);
          return { status: 201, value: { status: 'uploading', feature, releaseId } };
        });
        sendJson(response, result.status, result.value);
        return;
      }

      if (method === 'PUT' && parts[0] === 'v1' && parts[1] === 'admin' && parts[2] === 'releases' && parts.length === 6 && parts[5] === 'archive') {
        requireOperator(request, token);
        const feature = safeFeature(parts[3]);
        const releaseId = safeRelease(parts[4]);
        const directory = uploadDirectory(root, feature, releaseId);
        const staged = loadState(root).releases[releaseKey(feature, releaseId)];
        if (!staged) throw new HttpError(409, 'manifest-required', 'Upload the verified release manifest before the archive.');
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const temporary = resolve(directory, `archive-${randomUUID()}.part`);
        const uploaded = await writeArchive(request, temporary, PROTOCOL_LIMITS.maxArchiveBytes);
        const result = await mutate(() => {
          const state = loadState(root);
          const key = releaseKey(feature, releaseId);
          const current = state.releases[key];
          if (!current) throw new HttpError(409, 'manifest-required', 'Upload the verified release manifest before the archive.');
          if (current.archiveBytes !== uploaded.bytes || current.archiveSha256 !== uploaded.sha256) throw new HttpError(422, 'archive-mismatch', 'Archive bytes do not match the signed release manifest.');
          if (current.status === 'ready') {
            rmSync(temporary, { force: true });
            return { status: 200, value: { status: 'ready', idempotent: true, feature, releaseId } };
          }
          const sourceManifest = resolve(directory, 'manifest.json');
          if (!existsSync(sourceManifest)) throw new HttpError(409, 'manifest-required', 'Release manifest staging is unavailable.');
          const destination = releaseDirectory(root, feature, releaseId);
          mkdirSync(destination, { recursive: true, mode: 0o700 });
          renameSync(sourceManifest, resolve(destination, 'manifest.json'));
          renameSync(temporary, resolve(destination, 'release.zip'));
          current.status = 'ready';
          current.readyAt = new Date().toISOString();
          saveState(root, state);
          return { status: 201, value: { status: 'ready', feature, releaseId, archiveSha256: uploaded.sha256 } };
        });
        sendJson(response, result.status, result.value);
        return;
      }

      if (method === 'POST' && parts[0] === 'v1' && parts[1] === 'admin' && parts[2] === 'channels' && parts.length === 6 && parts[5] === 'promote') {
        requireOperator(request, token);
        const feature = safeFeature(parts[3]);
        const channel = safeChannel(parts[4]);
        const body = parseOperatorJson(await readBody(request, MAX_ADMIN_JSON_BYTES));
        const releaseId = safeRelease(body.releaseId);
        const selectedActivation = activation(body.activation);
        const force = body.force === true;
        if (body.force !== undefined && typeof body.force !== 'boolean') throw new HttpError(400, 'invalid-force', 'force must be a boolean.');
        const idempotencyKey = request.headers['idempotency-key'];
        if (idempotencyKey !== undefined && (typeof idempotencyKey !== 'string' || idempotencyKey.length < 1 || idempotencyKey.length > 128)) {
          throw new HttpError(400, 'invalid-idempotency-key', 'Idempotency-Key must be 1 to 128 characters.');
        }
        const result = await mutate(() => {
          const state = loadState(root);
          const requestFingerprint = sha256(Buffer.from(JSON.stringify({ feature, channel, releaseId, activation: selectedActivation, force })));
          if (idempotencyKey) {
            const prior = state.idempotency[idempotencyKey];
            if (prior) {
              if (prior.fingerprint !== requestFingerprint) throw new HttpError(409, 'idempotency-conflict', 'Idempotency-Key was used for a different operation.');
              return { status: 200, value: prior.result };
            }
          }
          const release = state.releases[releaseKey(feature, releaseId)];
          if (!release || release.status !== 'ready') throw new HttpError(409, 'release-not-ready', 'Only ready releases can be promoted.');
          const key = channelKey(feature, channel);
          const revision = (state.channels[key]?.revision ?? 0) + 1;
          const payload = Buffer.from(`${JSON.stringify({ type: 'lynx-channel', feature, channel, revision, releaseId, manifestUrl: `/v1/releases/${feature}/${releaseId}/manifest`, manifestSha256: release.manifestSha256, runtimeVersion: release.runtimeVersion, activation: selectedActivation, force, issuedAt: new Date().toISOString() })}\n`);
          const envelope = Buffer.from(`${JSON.stringify(signPayloadBytes(payload, 'lynx-channel', privateKeyPath))}\n`);
          const value = { feature, channel, releaseId, revision, activation: selectedActivation, force, status: 'promoted' };
          state.channels[key] = { revision, releaseId, envelope: envelope.toString('base64'), envelopeSha256: sha256(envelope), updatedAt: new Date().toISOString() };
          if (idempotencyKey) {
            state.idempotency[idempotencyKey] = { fingerprint: requestFingerprint, result: value };
            const entries = Object.keys(state.idempotency);
            for (const staleKey of entries.slice(0, Math.max(0, entries.length - 1000))) delete state.idempotency[staleKey];
          }
          saveState(root, state);
          return { status: 201, value };
        });
        sendJson(response, result.status, result.value);
        return;
      }

      throw new HttpError(404, 'not-found', 'Route was not found.');
    } catch (error) {
      if (!response.headersSent) sendError(response, error);
      else response.destroy();
    }
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(options.port, options.host, () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  const listeningPort = typeof address === 'object' && address ? address.port : options.port;
  const base = `http://${options.host === '0.0.0.0' ? '127.0.0.1' : options.host}:${listeningPort}`;
  process.stdout.write(`Local Lynx delivery ready: ${base}\n`);
  process.stdout.write(`Public deployment example: ${base}/v1/channels/delivery/active\n`);
  if (options.host === '0.0.0.0') {
    const lanAddresses = Object.values(networkInterfaces()).flat().filter((entry) => entry?.family === 'IPv4' && !entry.internal);
    for (const entry of lanAddresses) {
      process.stdout.write(`Device deployment example: http://${entry.address}:${listeningPort}/v1/channels/delivery/active\n`);
    }
  }
  process.stdout.write(`Storage: ${root}\n`);
  if (options.host !== '127.0.0.1' && options.host !== 'localhost') process.stderr.write('Warning: this local test server is reachable on the configured network interface. Keep its publisher token private.\n');
  const shutdown = () => server.close(() => process.exit(0));
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

function parseReleaseIdentity(envelopeBytes) {
  try {
    const envelope = JSON.parse(envelopeBytes.toString('utf8'));
    const payload = JSON.parse(Buffer.from(envelope.payload, 'base64url').toString('utf8'));
    return { feature: safeFeature(payload.feature), releaseId: safeRelease(payload.releaseId) };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new Error('release-envelope.json is not a valid Lynx release envelope.');
  }
}

function serverUrl(base, pathname) {
  const url = new URL(base);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('--server must use http or https.');
  if (url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error('--server must be a base URL without a path, query, or fragment.');
  return new URL(pathname, url).toString();
}

async function request(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = (await response.text()).slice(0, 512);
    throw new Error(`Request failed (${response.status}): ${text}`);
  }
  return response;
}

async function publish(options) {
  const directory = resolve(repositoryRoot, required(options.releaseDir, '--release-dir'));
  const manifest = resolve(directory, 'release-envelope.json');
  const archive = resolve(directory, 'release.zip');
  if (!existsSync(manifest) || !existsSync(archive)) throw new Error('--release-dir must contain release-envelope.json and release.zip.');
  const envelopeBytes = readFileSync(manifest);
  const { feature, releaseId } = parseReleaseIdentity(envelopeBytes);
  const token = required(options.token, '--token');
  const headers = { Authorization: `Bearer ${token}` };
  await request(serverUrl(options.server, `/v1/admin/releases/${feature}/${releaseId}/manifest`), {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': String(envelopeBytes.byteLength) },
    body: envelopeBytes,
  });
  const archiveStats = statSync(archive);
  await request(serverUrl(options.server, `/v1/admin/releases/${feature}/${releaseId}/archive`), {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/zip', 'Content-Length': String(archiveStats.size) },
    body: createReadStream(archive),
    duplex: 'half',
  });
  const channel = safeChannel(options.channel ?? 'active');
  const body = { releaseId, activation: options.activation ?? 'next-open', force: options.force === true };
  const promotion = await request(serverUrl(options.server, `/v1/admin/channels/${feature}/${channel}/promote`), {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': `publish:${feature}:${releaseId}:${channel}` },
    body: JSON.stringify(body),
  });
  process.stdout.write(`${JSON.stringify({ status: 'published', feature, releaseId, promotion: promotion ? await promotion.json() : null }, null, 2)}\n`);
}

async function promote(options) {
  const feature = safeFeature(required(options.feature, '--feature'));
  const channel = safeChannel(options.channel ?? 'active');
  const releaseId = safeRelease(required(options.releaseId, '--release-id'));
  const response = await request(serverUrl(options.server, `/v1/admin/channels/${feature}/${channel}/promote`), {
    method: 'POST',
    headers: { Authorization: `Bearer ${required(options.token, '--token')}`, 'Content-Type': 'application/json', 'Idempotency-Key': `promote:${feature}:${channel}:${releaseId}:${options.activation ?? 'next-open'}:${options.force === true}` },
    body: JSON.stringify({ releaseId, activation: options.activation ?? 'next-open', force: options.force === true }),
  });
  process.stdout.write(`${JSON.stringify(await response.json(), null, 2)}\n`);
}

async function main() {
  const [command, ...raw] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') {
    usage();
    return;
  }
  const values = args(raw);
  if (command === 'serve') {
    const port = Number(values.get('--port') ?? '3000');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be between 1 and 65535.');
    await serve({
      host: values.get('--host') ?? '0.0.0.0',
      port,
      storageDir: values.get('--storage-dir') ?? '.local-lynx-delivery',
      token: required(values.get('--token') ?? process.env.LYNX_DELIVERY_LOCAL_TOKEN, '--token or LYNX_DELIVERY_LOCAL_TOKEN'),
      privateKey: required(values.get('--private-key'), '--private-key'),
      publicKey: required(values.get('--public-key'), '--public-key'),
    });
    return;
  }
  if (command === 'publish') {
    await publish({ server: required(values.get('--server'), '--server'), token: values.get('--token') ?? process.env.LYNX_DELIVERY_LOCAL_TOKEN, releaseDir: values.get('--release-dir'), channel: values.get('--channel'), activation: values.get('--activation'), force: values.get('--force') === true });
    return;
  }
  if (command === 'promote') {
    await promote({ server: required(values.get('--server'), '--server'), token: values.get('--token') ?? process.env.LYNX_DELIVERY_LOCAL_TOKEN, feature: values.get('--feature'), channel: values.get('--channel'), releaseId: values.get('--release-id'), activation: values.get('--activation'), force: values.get('--force') === true });
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
