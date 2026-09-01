import { hexToBase64, sha256Hex } from './protocol.ts';
import { presignR2Put } from './r2-presign.ts';

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const UPLOAD_EXPIRY_SECONDS = 15 * 60;
const featureId = /^[a-z][a-z0-9-]{0,63}$/;
const bundleId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const sha256 = /^[a-f0-9]{64}$/;
const protocolVersion = /^[\u0020-\u007e]{1,128}$/;

export interface ControlEnv {
  ARTIFACTS: R2Bucket;
  DB: D1Database;
  CONTROL_TOKEN: string;
  DELIVERY_SIGNING_PRIVATE_KEY: string;
  R2_ACCESS_KEY_ID?: string;
  R2_ACCOUNT_ID?: string;
  R2_BUCKET_NAME?: string;
  R2_SECRET_ACCESS_KEY?: string;
  /** Set only by the local Wrangler configuration. Never set in production. */
  LOCAL_UPLOADS?: string | boolean;
}

export type UpdateDeployment =
  | { enabled: boolean }
  | { bundleId: string; force: boolean };

export type ReleaseMetadata = {
  schemaVersion: 1;
  feature: string;
  releaseId: string;
  version: string;
  runtimeVersion: string;
  archiveSha256: string;
  archiveBytes: number;
};

type BundleRow = {
  id: string;
  featureId: string;
  version: string;
  runtimeVersion: string;
  archiveSha256: string;
  archiveBytes: number;
  createdAt: string;
};

type DeploymentRow = {
  featureId: string;
  bundleId: string | null;
  enabled: number;
  force: number;
  revision: number;
  updatedAt: string;
};

type UploadInstruction = {
  method: 'PUT';
  url: string | null;
  headers: Record<string, string>;
  uploaded?: boolean;
};

class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    status: number,
    code: string,
    message: string,
  ) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function getDeploymentOverview(
  environment: ControlEnv,
  request: Request,
  feature: string,
): Promise<Response> {
  return handleControlRequest(environment, request, async () => {
    assertFeature(feature);
    return jsonResponse(200, await readOverview(environment, feature));
  });
}

export async function updateDeployment(
  environment: ControlEnv,
  request: Request,
  feature: string,
  update: UpdateDeployment,
): Promise<Response> {
  return handleControlRequest(environment, request, async () => {
    assertFeature(feature);
    validateUpdate(update);
    const current = await readDeployment(environment, feature);
    const enabled = current?.enabled === 1;
    const currentBundleId = current?.bundleId ?? null;
    const currentRevision = current?.revision ?? 0;

    let nextEnabled = enabled;
    let nextBundleId = currentBundleId;
    let nextForce = false;

    if ('enabled' in update) {
      if (update.enabled === enabled) return jsonResponse(200, await readOverview(environment, feature));
      if (update.enabled && !currentBundleId) {
        throw new ApiError(409, 'deployment-empty', 'Select a bundle before enabling delivery.');
      }
      nextEnabled = update.enabled;
    } else {
      const bundle = await readBundle(environment, feature, update.bundleId);
      if (!bundle) throw new ApiError(404, 'bundle-not-found', 'Registered bundle was not found.');
      if (currentBundleId === bundle.id && !update.force) {
        return jsonResponse(200, await readOverview(environment, feature));
      }
      nextBundleId = bundle.id;
      nextForce = update.force;
    }

    const revision = currentRevision + 1;
    const updatedAt = new Date().toISOString();
    const result = await environment.DB.prepare(
      `INSERT INTO deployments (
        feature_id, bundle_id, enabled, force, revision, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(feature_id) DO UPDATE SET
        bundle_id = excluded.bundle_id,
        enabled = excluded.enabled,
        force = excluded.force,
        revision = excluded.revision,
        updated_at = excluded.updated_at
      WHERE deployments.revision = ?`,
    )
      .bind(
        feature,
        nextBundleId,
        nextEnabled ? 1 : 0,
        nextForce ? 1 : 0,
        revision,
        updatedAt,
        currentRevision,
      )
      .run();
    if (Number(result.meta.changes ?? 0) !== 1) {
      throw new ApiError(409, 'deployment-conflict', 'Deployment changed concurrently; refresh and try again.');
    }
    return jsonResponse(200, await readOverview(environment, feature));
  });
}

export async function registerUpload(
  environment: ControlEnv,
  request: Request,
  input: unknown,
): Promise<Response> {
  return handleControlRequest(environment, request, async () => {
    const release = parseReleaseMetadata(input);
    const existing = await readBundle(environment, release.feature, release.releaseId);
    if (existing) {
      if (sameBundle(existing, release)) {
        return jsonResponse(200, { bundleId: release.releaseId, complete: true });
      }
      throw new ApiError(409, 'bundle-conflict', 'Bundle ID is already assigned to different immutable metadata.');
    }

    const key = archiveObjectKey(release.feature, release.releaseId);
    const head = await environment.ARTIFACTS.head(key);
    if (head) {
      await requireObject(environment.ARTIFACTS, key, release.archiveSha256, release.archiveBytes);
      return jsonResponse(200, {
        bundleId: release.releaseId,
        complete: false,
        upload: { method: 'PUT', url: null, headers: {}, uploaded: true } satisfies UploadInstruction,
      });
    }

    return jsonResponse(200, {
      bundleId: release.releaseId,
      complete: false,
      expiresIn: UPLOAD_EXPIRY_SECONDS,
      upload: await createUploadInstruction(environment, request, key, release.archiveSha256),
    });
  });
}

export async function completeUpload(
  environment: ControlEnv,
  request: Request,
  routeBundleId: string,
  input: unknown,
): Promise<Response> {
  return handleControlRequest(environment, request, async () => {
    if (!bundleId.test(routeBundleId)) {
      throw new ApiError(400, 'invalid-request', 'Bundle ID is invalid.');
    }
    const release = parseReleaseMetadata(input);
    if (release.releaseId !== routeBundleId) {
      throw new ApiError(409, 'bundle-conflict', 'Route bundle ID does not match release metadata.');
    }
    const existing = await readBundle(environment, release.feature, routeBundleId);
    if (existing) {
      if (sameBundle(existing, release)) return jsonResponse(200, { bundle: publicBundle(existing), created: false });
      throw new ApiError(409, 'bundle-conflict', 'Bundle ID is already assigned to different immutable metadata.');
    }

    await requireObject(
      environment.ARTIFACTS,
      archiveObjectKey(release.feature, release.releaseId),
      release.archiveSha256,
      release.archiveBytes,
    );
    const createdAt = new Date().toISOString();
    const result = await environment.DB.prepare(
      `INSERT INTO bundles (
        id, feature_id, version, runtime_version, archive_sha256, archive_bytes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING`,
    )
      .bind(
        release.releaseId,
        release.feature,
        release.version,
        release.runtimeVersion,
        release.archiveSha256,
        release.archiveBytes,
        createdAt,
      )
      .run();
    if (Number(result.meta.changes ?? 0) !== 1) {
      throw new ApiError(409, 'bundle-conflict', 'Bundle completion raced with another request; retry it.');
    }
    const bundle = await readBundle(environment, release.feature, release.releaseId);
    if (!bundle) throw new Error('Inserted bundle could not be read.');
    return jsonResponse(201, { bundle: publicBundle(bundle), created: true });
  });
}

/** Local Miniflare-only equivalent of the short-lived R2 PUT URL. */
export async function handleLocalUpload(
  environment: ControlEnv,
  request: Request,
  feature: string,
  releaseId: string,
): Promise<Response> {
  if (request.method !== 'PUT' || !localUploadsEnabled(environment, request)) return notFound();
  try {
    assertFeature(feature);
    if (!bundleId.test(releaseId)) return notFound();
    const url = new URL(request.url);
    const expires = Number(url.searchParams.get('expires'));
    const digest = url.searchParams.get('sha256') ?? '';
    const signature = url.searchParams.get('signature') ?? '';
    if (!Number.isSafeInteger(expires) || expires < Date.now() || !sha256.test(digest)) return notFound();
    const key = archiveObjectKey(feature, releaseId);
    if (!(await matchesCapability(environment.CONTROL_TOKEN, key, digest, expires, signature))) return notFound();
    if (request.headers.get('Content-Type')?.toLowerCase() !== 'application/zip') {
      throw new ApiError(400, 'invalid-request', 'Local upload must use application/zip.');
    }
    if (request.headers.get('x-amz-checksum-sha256') !== hexToBase64(digest)) {
      throw new ApiError(400, 'checksum-mismatch', 'Local upload checksum header is invalid.');
    }
    const bytes = await readBoundedBody(request, MAX_ARCHIVE_BYTES);
    if ((await sha256Hex(bytes)) !== digest) {
      throw new ApiError(409, 'checksum-mismatch', 'Local upload bytes do not match the checksum.');
    }
    await environment.ARTIFACTS.put(key, bytes, {
      httpMetadata: { contentType: 'application/zip' },
    });
    return new Response(null, { status: 200 });
  } catch (error) {
    if (error instanceof ApiError) return jsonResponse(error.status, { error: { code: error.code, message: error.message } });
    return jsonResponse(500, { error: { code: 'internal-error', message: 'Local upload could not be completed.' } });
  }
}

async function createUploadInstruction(
  environment: ControlEnv,
  request: Request,
  key: string,
  expectedSha256: string,
): Promise<UploadInstruction> {
  const headers = {
    'content-type': 'application/zip',
    'if-none-match': '*',
    'x-amz-checksum-sha256': hexToBase64(expectedSha256),
  };
  if (localUploadsEnabled(environment, request)) {
    const expires = Date.now() + UPLOAD_EXPIRY_SECONDS * 1000;
    const signature = await createCapability(environment.CONTROL_TOKEN, key, expectedSha256, expires);
    const url = new URL(request.url);
    url.pathname = `/__local-r2/${key}`;
    url.search = '';
    url.searchParams.set('expires', String(expires));
    url.searchParams.set('sha256', expectedSha256);
    url.searchParams.set('signature', signature);
    return { method: 'PUT', url: url.toString(), headers };
  }
  requireR2PresignConfiguration(environment);
  const signed = await presignR2Put(
    {
      accountId: environment.R2_ACCOUNT_ID!,
      accessKeyId: environment.R2_ACCESS_KEY_ID!,
      secretAccessKey: environment.R2_SECRET_ACCESS_KEY!,
      bucketName: environment.R2_BUCKET_NAME!,
    },
    key,
    'application/zip',
    headers['x-amz-checksum-sha256'],
    UPLOAD_EXPIRY_SECONDS,
  );
  return { method: 'PUT', ...signed };
}

async function requireObject(
  bucket: R2Bucket,
  key: string,
  expectedSha256: string,
  expectedBytes: number,
): Promise<void> {
  const head = await bucket.head(key);
  if (!head || head.size !== expectedBytes || head.size > MAX_ARCHIVE_BYTES) {
    throw new ApiError(409, 'upload-incomplete', 'Uploaded ZIP is missing or has the wrong byte length.');
  }
  const checksum = head.checksums.sha256;
  const digest = checksum
    ? bytesToHex(new Uint8Array(checksum))
    : await hashStoredObject(bucket, key, expectedBytes);
  if (digest !== expectedSha256) {
    throw new ApiError(409, 'checksum-mismatch', 'Uploaded ZIP does not match release metadata.');
  }
}

async function hashStoredObject(bucket: R2Bucket, key: string, expectedBytes: number): Promise<string> {
  const object = await bucket.get(key);
  if (!object || !object.body || object.size !== expectedBytes || object.size > MAX_ARCHIVE_BYTES) {
    throw new ApiError(409, 'upload-incomplete', 'Uploaded ZIP is unavailable.');
  }
  const reader = object.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > expectedBytes || length > MAX_ARCHIVE_BYTES) {
      throw new ApiError(409, 'upload-incomplete', 'Uploaded ZIP exceeds its declared byte length.');
    }
    chunks.push(value);
  }
  if (length !== expectedBytes) throw new ApiError(409, 'upload-incomplete', 'Uploaded ZIP has the wrong byte length.');
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return sha256Hex(bytes);
}

async function readOverview(environment: ControlEnv, feature: string) {
  const [deployment, bundlesResult] = await Promise.all([
    readDeployment(environment, feature),
    environment.DB.prepare(
      `SELECT id, feature_id AS featureId, version, runtime_version AS runtimeVersion,
        archive_sha256 AS archiveSha256, archive_bytes AS archiveBytes, created_at AS createdAt
       FROM bundles WHERE feature_id = ? ORDER BY created_at DESC LIMIT 50`,
    ).bind(feature).all<BundleRow>(),
  ]);
  const selectedBundleId = deployment?.bundleId ?? null;
  const enabled = deployment?.enabled === 1;
  return {
    deployment: {
      feature,
      bundleId: selectedBundleId,
      enabled,
      force: deployment?.force === 1,
      revision: deployment?.revision ?? 0,
      updatedAt: deployment?.updatedAt ?? null,
      status: enabled ? (selectedBundleId ? 'active' : 'empty') : 'disabled',
    },
    bundles: (bundlesResult.results ?? []).map((bundle) => ({
      ...publicBundle(bundle),
      status: bundle.id === selectedBundleId && enabled ? 'active' : 'ready',
    })),
  };
}

async function readDeployment(environment: ControlEnv, feature: string): Promise<DeploymentRow | null> {
  return environment.DB.prepare(
    `SELECT feature_id AS featureId, bundle_id AS bundleId, enabled, force, revision,
      updated_at AS updatedAt FROM deployments WHERE feature_id = ? LIMIT 1`,
  ).bind(feature).first<DeploymentRow>();
}

async function readBundle(environment: ControlEnv, feature: string, id: string): Promise<BundleRow | null> {
  return environment.DB.prepare(
    `SELECT id, feature_id AS featureId, version, runtime_version AS runtimeVersion,
      archive_sha256 AS archiveSha256, archive_bytes AS archiveBytes, created_at AS createdAt
     FROM bundles WHERE feature_id = ? AND id = ? LIMIT 1`,
  ).bind(feature, id).first<BundleRow>();
}

function publicBundle(bundle: BundleRow) {
  return {
    id: bundle.id,
    feature: bundle.featureId,
    version: bundle.version,
    runtimeVersion: bundle.runtimeVersion,
    archiveSha256: bundle.archiveSha256,
    archiveBytes: bundle.archiveBytes,
    createdAt: bundle.createdAt,
  };
}

function sameBundle(bundle: BundleRow, release: ReleaseMetadata): boolean {
  return bundle.featureId === release.feature
    && bundle.version === release.version
    && bundle.runtimeVersion === release.runtimeVersion
    && bundle.archiveSha256 === release.archiveSha256
    && bundle.archiveBytes === release.archiveBytes;
}

function archiveObjectKey(feature: string, id: string): string {
  return `${feature}/releases/${id}/release.zip`;
}

function parseReleaseMetadata(input: unknown): ReleaseMetadata {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ApiError(400, 'invalid-request', 'Release metadata must be an object.');
  }
  const value = input as Record<string, unknown>;
  const allowed = ['schemaVersion', 'feature', 'releaseId', 'version', 'runtimeVersion', 'archiveSha256', 'archiveBytes'];
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new ApiError(400, 'invalid-request', 'Release metadata contains an unknown field.');
  }
  if (value.schemaVersion !== 1) throw new ApiError(400, 'invalid-request', 'Release metadata schemaVersion must be 1.');
  if (typeof value.feature !== 'string') throw new ApiError(400, 'invalid-request', 'Release feature is invalid.');
  assertFeature(value.feature);
  if (typeof value.releaseId !== 'string' || !bundleId.test(value.releaseId)) throw new ApiError(400, 'invalid-request', 'Release ID is invalid.');
  if (typeof value.version !== 'string' || !protocolVersion.test(value.version)) throw new ApiError(400, 'invalid-request', 'Release version is invalid.');
  if (typeof value.runtimeVersion !== 'string' || !protocolVersion.test(value.runtimeVersion)) throw new ApiError(400, 'invalid-request', 'Runtime version is invalid.');
  if (typeof value.archiveSha256 !== 'string' || !sha256.test(value.archiveSha256)) throw new ApiError(400, 'invalid-request', 'Archive SHA-256 must be lowercase hexadecimal.');
  const archiveBytes = value.archiveBytes;
  if (typeof archiveBytes !== 'number' || !Number.isSafeInteger(archiveBytes) || archiveBytes <= 0 || archiveBytes > MAX_ARCHIVE_BYTES) {
    throw new ApiError(400, 'invalid-request', `Archive bytes must be between 1 and ${MAX_ARCHIVE_BYTES}.`);
  }
  return value as ReleaseMetadata;
}

function validateUpdate(update: UpdateDeployment): void {
  if (!update || typeof update !== 'object' || Array.isArray(update)) throw new ApiError(400, 'invalid-request', 'Deployment update is invalid.');
  const keys = Object.keys(update);
  if ('enabled' in update && keys.length === 1 && typeof update.enabled === 'boolean') return;
  if ('bundleId' in update && 'force' in update && keys.length === 2 && typeof update.bundleId === 'string' && bundleId.test(update.bundleId) && typeof update.force === 'boolean') return;
  throw new ApiError(400, 'invalid-request', 'Deployment update is invalid.');
}

function assertFeature(feature: string): void {
  if (!featureId.test(feature)) throw new ApiError(400, 'invalid-request', 'Feature is invalid.');
}

function requireR2PresignConfiguration(environment: ControlEnv): void {
  const missing = [
    ['R2_ACCOUNT_ID', environment.R2_ACCOUNT_ID],
    ['R2_BUCKET_NAME', environment.R2_BUCKET_NAME],
    ['R2_ACCESS_KEY_ID', environment.R2_ACCESS_KEY_ID],
    ['R2_SECRET_ACCESS_KEY', environment.R2_SECRET_ACCESS_KEY],
  ].filter(([, value]) => !value?.trim()).map(([name]) => name);
  if (missing.length > 0) throw new ApiError(503, 'upload-not-configured', 'R2 upload is not configured.');
}

async function handleControlRequest(environment: ControlEnv, request: Request, operation: () => Promise<Response>): Promise<Response> {
  try {
    if (!(await isAuthorized(request, environment.CONTROL_TOKEN))) {
      return jsonResponse(401, { error: { code: 'unauthorized', message: 'Authentication is required.' } });
    }
    return await operation();
  } catch (error) {
    if (error instanceof ApiError) return jsonResponse(error.status, { error: { code: error.code, message: error.message } });
    return jsonResponse(500, { error: { code: 'internal-error', message: 'Request could not be completed.' } });
  }
}

async function isAuthorized(request: Request, token: string): Promise<boolean> {
  const supplied = request.headers.get('Authorization');
  if (!token || !supplied?.startsWith('Bearer ')) return false;
  const [expectedHash, suppliedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)),
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(supplied.slice('Bearer '.length))),
  ]);
  const expected = new Uint8Array(expectedHash);
  const actual = new Uint8Array(suppliedHash);
  let difference = expected.length ^ actual.length;
  for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ (actual[index] ?? 0);
  return difference === 0;
}

function localUploadsEnabled(environment: ControlEnv, request: Request): boolean {
  const hostname = new URL(request.url).hostname;
  return (environment.LOCAL_UPLOADS === 'true' || environment.LOCAL_UPLOADS === true)
    && (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1');
}

async function createCapability(token: string, key: string, digest: string, expires: number): Promise<string> {
  const secret = await crypto.subtle.importKey('raw', new TextEncoder().encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', secret, new TextEncoder().encode(`${key}\n${digest}\n${expires}`)));
  let binary = '';
  for (const byte of signature) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function matchesCapability(token: string, key: string, digest: string, expires: number, signature: string): Promise<boolean> {
  const expected = await createCapability(token, key, digest, expires);
  if (expected.length !== signature.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return difference === 0;
}

async function readBoundedBody(request: Request, maximum: number): Promise<Uint8Array> {
  const contentLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(contentLength) && (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > maximum)) {
    throw new ApiError(413, 'invalid-request', 'Local upload exceeds the ZIP size limit.');
  }
  if (!request.body) throw new ApiError(400, 'invalid-request', 'Local upload body is required.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) throw new ApiError(413, 'invalid-request', 'Local upload exceeds the ZIP size limit.');
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function notFound(): Response {
  return jsonResponse(404, { error: { code: 'not-found', message: 'Resource was not found.' } });
}

function jsonResponse(status: number, value: unknown): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
