import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AwsClient } from 'aws4fetch';

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const featureId = /^[a-z][a-z0-9-]{0,63}$/;
const appId = /^[a-z][a-z0-9-]{0,63}$/;
const releaseId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const sha256 = /^[a-f0-9]{64}$/;
const protocolVersion = /^[\u0020-\u007e]{1,128}$/;

/**
 * Registers release metadata, sends the ZIP directly to R2, then asks the
 * Worker to verify and register it. Local Worker development uses its local
 * upload capability instead.
 */
export async function uploadRelease({ releaseDirectory, server, apiKey, r2, fetchImpl = fetch, r2FetchImpl }) {
  const endpoint = normalizeServer(server);
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new Error('A delivery API key is required. Set LYNX_DELIVERY_API_KEY or pass --api-key.');
  }
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');

  const artifacts = await readArtifacts(releaseDirectory);
  const authorization = { Authorization: `Bearer ${apiKey}` };
  const registration = await requestJson(
    fetchImpl,
    `${endpoint}/api/uploads`,
    {
      method: 'POST',
      headers: { ...authorization, 'content-type': 'application/json' },
      body: JSON.stringify(artifacts.release),
    },
    'Registration',
  );
  const bundleId = requireBundleId(registration.bundleId);
  if (bundleId !== artifacts.release.releaseId) {
    throw new Error('Registration returned a different bundle ID.');
  }
  if (registration.complete === true) {
    return {
      bundle: { id: bundleId, version: artifacts.release.version, runtimeVersion: artifacts.release.runtimeVersion },
      created: false,
      alreadyComplete: true,
    };
  }
  if (registration.complete !== false) throw new Error('Registration returned an invalid completion state.');

  if (registration.uploaded !== true) {
    if (registration.upload) {
      const upload = requireUpload(registration.upload);
      await uploadArchive(fetchImpl, upload, artifacts.archiveBytes);
    } else {
      await uploadDirectlyToR2(r2, artifacts, r2FetchImpl);
    }
  }

  const completion = await requestJson(
    fetchImpl,
    `${endpoint}/api/uploads/${encodeURIComponent(bundleId)}/complete`,
    {
      method: 'POST',
      headers: { ...authorization, 'content-type': 'application/json' },
      body: JSON.stringify(artifacts.release),
    },
    'Completion',
  );
  const bundle = requireObject(completion.bundle, 'Completion returned an invalid bundle.');
  if (
    bundle.id !== bundleId || bundle.version !== artifacts.release.version ||
    bundle.runtimeVersion !== artifacts.release.runtimeVersion ||
    bundle.archiveSha256 !== artifacts.release.archiveSha256 ||
    bundle.archiveBytes !== artifacts.release.archiveBytes ||
    typeof completion.created !== 'boolean'
  ) throw new Error('Completion returned metadata different from the uploaded release.');
  return { bundle, created: completion.created, alreadyComplete: false };
}

async function uploadDirectlyToR2(r2, artifacts, r2FetchImpl) {
  const configuration = requireR2Configuration(r2);
  const app = artifacts.release.appId ?? 'default';
  const key = `${app}/${artifacts.release.feature}/releases/${artifacts.release.releaseId}/release.zip`;
  const url = r2ObjectUrl(configuration.accountId, configuration.bucketName, key);
  const headers = {
    'content-type': 'application/zip',
    'if-none-match': '*',
    'x-amz-checksum-sha256': Buffer.from(artifacts.release.archiveSha256, 'hex').toString('base64'),
  };
  const client = new AwsClient({
    accessKeyId: configuration.accessKeyId,
    secretAccessKey: configuration.secretAccessKey,
    service: 's3',
    region: 'auto',
  });
  const r2Fetch = r2FetchImpl ?? client.fetch.bind(client);
  await uploadArchive(r2Fetch, { method: 'PUT', url, headers }, artifacts.archiveBytes, true);
}

async function readArtifacts(releaseDirectory) {
  const directory = resolve(releaseDirectory);
  const [directoryStat, releaseBytes, archiveBytes] = await Promise.all([
    stat(directory).catch(() => null),
    readFile(resolve(directory, 'release.json')).catch((error) => missingArtifact('release.json', error)),
    readFile(resolve(directory, 'release.zip')).catch((error) => missingArtifact('release.zip', error)),
  ]);
  if (!directoryStat?.isDirectory()) throw new Error(`Release directory was not found: ${directory}`);
  const release = parseReleaseMetadata(releaseBytes);
  if (archiveBytes.byteLength !== release.archiveBytes) {
    throw new Error(`release.zip byte length does not match release.json (${release.archiveBytes} expected).`);
  }
  if (archiveBytes.byteLength === 0 || archiveBytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error(`release.zip must be between 1 byte and ${MAX_ARCHIVE_BYTES} bytes.`);
  }
  return { release, archiveBytes };
}

function parseReleaseMetadata(bytes) {
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('release.json must contain valid JSON.'); }
  const release = requireObject(value, 'release.json must contain an object.');
  const allowed = ['schemaVersion', 'appId', 'feature', 'releaseId', 'version', 'runtimeVersion', 'archiveSha256', 'archiveBytes'];
  if (Object.keys(release).some((key) => !allowed.includes(key))) {
    throw new Error('release.json contains an unknown field.');
  }
  if (release.schemaVersion !== 1) throw new Error('release.json schemaVersion must be 1.');
  if (release.appId !== undefined && (typeof release.appId !== 'string' || !appId.test(release.appId))) throw new Error('release.json appId is invalid.');
  if (typeof release.feature !== 'string' || !featureId.test(release.feature)) throw new Error('release.json feature is invalid.');
  if (typeof release.releaseId !== 'string' || !releaseId.test(release.releaseId)) throw new Error('release.json releaseId is invalid.');
  if (typeof release.version !== 'string' || !protocolVersion.test(release.version)) throw new Error('release.json version is invalid.');
  if (typeof release.runtimeVersion !== 'string' || !protocolVersion.test(release.runtimeVersion)) throw new Error('release.json runtimeVersion is invalid.');
  if (typeof release.archiveSha256 !== 'string' || !sha256.test(release.archiveSha256)) throw new Error('release.json archiveSha256 must be lowercase SHA-256.');
  if (!Number.isSafeInteger(release.archiveBytes) || release.archiveBytes <= 0 || release.archiveBytes > MAX_ARCHIVE_BYTES) {
    throw new Error(`release.json archiveBytes must be between 1 and ${MAX_ARCHIVE_BYTES}.`);
  }
  return release;
}

function missingArtifact(name, error) {
  if (error?.code === 'ENOENT') throw new Error(`Release directory is missing ${name}. Run pnpm lynx release <feature> --draft first.`);
  throw error;
}

async function uploadArchive(fetchImpl, upload, archiveBytes, directR2 = false) {
  let response;
  try {
    response = await fetchImpl(upload.url, {
      method: upload.method,
      headers: upload.headers,
      body: archiveBytes,
      redirect: 'error',
    });
  } catch {
    throw new Error(directR2
      ? 'R2 upload failed: the direct R2 endpoint could not be reached.'
      : 'R2 upload failed: the local Worker upload URL could not be reached.');
  }
  if (!response?.ok) {
    const accessHint = directR2 && response?.status === 403
      ? ' Check that R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are an R2 S3 access key with Object Read & Write for the configured bucket.'
      : '';
    throw new Error(`R2 upload failed with HTTP ${response?.status ?? 'unknown'}${await r2ErrorCode(response)}.${accessHint}`);
  }
}

async function r2ErrorCode(response) {
  const body = await response.text().catch(() => '');
  const match = body.match(/<Code>([A-Za-z]+)<\/Code>/);
  return match ? ` — R2 ${match[1]}` : '';
}

function requireR2Configuration(value) {
  const r2 = requireObject(value, 'Direct R2 upload requires R2 credentials. Source .env.lynx with `set -a; source .env.lynx; set +a`.');
  const fields = ['accountId', 'bucketName', 'accessKeyId', 'secretAccessKey'];
  if (fields.some((field) => typeof r2[field] !== 'string' || r2[field].trim().length === 0)) {
    throw new Error('Direct R2 upload requires account ID, bucket name, access key ID, and secret access key. Source .env.lynx with `set -a; source .env.lynx; set +a`.');
  }
  return r2;
}

function r2ObjectUrl(accountId, bucketName, key) {
  const encode = (part) => encodeURIComponent(part);
  return `https://${accountId}.r2.cloudflarestorage.com/${[bucketName, ...key.split('/')].map(encode).join('/')}`;
}

async function requestJson(fetchImpl, url, init, stage) {
  let response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    const cause = connectionCause(error);
    throw new Error(`${stage} failed at ${url}: the delivery Worker could not be reached${cause ? ` (${cause})` : ''}.`);
  }
  let payload;
  try { payload = await response.json(); } catch { throw new Error(`${stage} failed at ${url}: Worker returned invalid JSON.`); }
  if (!response.ok) {
    const message = payload?.error?.message;
    throw new Error(`${stage} failed at ${url}: HTTP ${response.status}${typeof message === 'string' ? ` — ${message}` : ''}.`);
  }
  return requireObject(payload, `${stage} failed at ${url}: Worker returned invalid JSON.`);
}

function normalizeServer(server) {
  let url;
  try { url = new URL(server); } catch { throw new Error('--server must be an absolute http(s) URL.'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('--server must use http or https.');
  if (url.search || url.hash) throw new Error('--server must not include a query string or hash.');
  return url.toString().replace(/\/$/, '');
}

function requireBundleId(value) {
  if (typeof value !== 'string' || !releaseId.test(value)) throw new Error('Registration returned an invalid bundle ID.');
  return value;
}

function requireUpload(value) {
  const upload = requireObject(value, 'Registration did not return an upload instruction.');
  if (upload.uploaded === true && upload.url === null) return { uploaded: true };
  if (upload.uploaded !== undefined && upload.uploaded !== false) throw new Error('Registration returned an invalid upload instruction.');
  if (upload.method !== 'PUT' || typeof upload.url !== 'string' || upload.url.length === 0) {
    throw new Error('Registration returned an invalid upload instruction.');
  }
  let parsed;
  try { parsed = new URL(upload.url); } catch { throw new Error('Registration returned an invalid upload instruction.'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Registration returned an invalid upload instruction.');
  return { uploaded: false, method: 'PUT', url: upload.url, headers: requireHeaders(upload.headers) };
}

function requireHeaders(value) {
  const headers = requireObject(value, 'Registration returned invalid upload headers.');
  for (const [key, headerValue] of Object.entries(headers)) {
    if (typeof headerValue !== 'string' || /\r|\n/.test(key) || /\r|\n/.test(headerValue)) {
      throw new Error('Registration returned invalid upload headers.');
    }
  }
  return headers;
}

function requireObject(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value;
}

function connectionCause(error) {
  if (!(error instanceof Error)) return null;
  if (error.cause instanceof Error && error.cause.message) return error.cause.message;
  return error.message || null;
}
