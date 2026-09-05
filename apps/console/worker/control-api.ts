import { and, desc, eq } from 'drizzle-orm';

import { hexToBase64, sha256Hex } from './protocol.ts';
import {
  authenticateApiKey,
  authenticatePassword,
  authenticateSession,
  clearSessionCookie,
  createSessionCookie,
  type AuthEnv,
} from './auth.ts';
import {
  type DeploymentUpdateInput,
  type LoginInput,
  type ReleaseMetadata,
} from './schema.ts';
import { createDeliveryDatabase } from './db/client.ts';
import { bundles, deployments } from './db/schema.ts';

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const UPLOAD_EXPIRY_SECONDS = 15 * 60;
const featureId = /^[a-z][a-z0-9-]{0,63}$/;
const appId = /^[a-z][a-z0-9-]{0,63}$/;
const bundleId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const sha256 = /^[a-f0-9]{64}$/;
const runtimeVersion = /^[\u0020-\u007e]{1,128}$/;

export interface ControlEnv extends AuthEnv {
  ARTIFACTS: R2Bucket;
  DELIVERY_SIGNING_PRIVATE_KEY: string;
  /** Set only by the local Wrangler configuration. Never set in production. */
  LOCAL_UPLOADS?: string | boolean;
}

type UpdateDeployment =
  | { enabled: boolean }
  | { bundleId: string; force: boolean };

type BundleRow = typeof bundles.$inferSelect;
type DeploymentRow = typeof deployments.$inferSelect;

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
  appOrFeature: string,
  requestedFeature?: string,
): Promise<Response> {
  return handleConsoleRequest(environment, request, async () => {
    const [app, feature] = deploymentScope(appOrFeature, requestedFeature);
    assertApp(app);
    assertFeature(feature);
    return jsonResponse(200, await readOverview(environment, app, feature, requestRuntimeVersion(request)));
  });
}

export async function getDeploymentScopes(
  environment: ControlEnv,
  request: Request,
): Promise<Response> {
  return handleConsoleRequest(environment, request, async () => {
    const database = createDeliveryDatabase(environment.DB);
    const [bundleScopes, deploymentScopes] = await Promise.all([
      database.select({ appId: bundles.appId, feature: bundles.featureId, runtimeVersion: bundles.runtimeVersion })
        .from(bundles)
        .groupBy(bundles.appId, bundles.featureId, bundles.runtimeVersion),
      database.select({ appId: deployments.appId, feature: deployments.featureId, runtimeVersion: deployments.runtimeVersion })
        .from(deployments)
        .groupBy(deployments.appId, deployments.featureId, deployments.runtimeVersion),
    ]);
    const scopes = new Map<string, { appId: string; feature: string; runtimeVersion: string }>();
    for (const scope of [...bundleScopes, ...deploymentScopes]) {
      scopes.set(`${scope.appId}/${scope.feature}/${scope.runtimeVersion}`, scope);
    }
    return jsonResponse(200, [...scopes.values()].sort((left, right) =>
      left.appId.localeCompare(right.appId) || left.feature.localeCompare(right.feature),
    ));
  });
}

export async function updateDeployment(
  environment: ControlEnv,
  request: Request,
  appOrFeature: string,
  requestedFeatureOrInput: string | DeploymentUpdateInput,
  maybeInput?: DeploymentUpdateInput,
): Promise<Response> {
  return handleConsoleRequest(environment, request, async () => {
    const [app, feature] = deploymentScope(appOrFeature, typeof requestedFeatureOrInput === 'string' ? requestedFeatureOrInput : undefined);
    const input = (maybeInput ?? requestedFeatureOrInput) as DeploymentUpdateInput;
    assertApp(app);
    assertFeature(feature);
    const selectedRuntimeVersion = requestRuntimeVersion(request);
    const update = normalizeUpdate(input);
    const current = await readDeployment(environment, app, feature, selectedRuntimeVersion);
    const enabled = current?.enabled ?? false;
    const currentBundleId = current?.bundleId ?? null;
    const currentRevision = current?.revision ?? 0;

    let nextEnabled = enabled;
    let nextBundleId = currentBundleId;
    let nextForce = false;

    if ('enabled' in update) {
      if (update.enabled === enabled) return jsonResponse(200, await readOverview(environment, app, feature, selectedRuntimeVersion));
      if (update.enabled && !currentBundleId) {
        throw new ApiError(409, 'deployment-empty', 'Select a bundle before enabling delivery.');
      }
      nextEnabled = update.enabled;
    } else {
      const bundle = await readBundle(environment, app, feature, update.bundleId);
      if (!bundle) throw new ApiError(404, 'bundle-not-found', 'Registered bundle was not found.');
      if (bundle.runtimeVersion !== selectedRuntimeVersion) {
        throw new ApiError(409, 'runtime-mismatch', 'Select a bundle built for the current runtime.');
      }
      if (currentBundleId === bundle.id && !update.force) {
        return jsonResponse(200, await readOverview(environment, app, feature, selectedRuntimeVersion));
      }
      nextBundleId = bundle.id;
      nextForce = update.force;
    }

    const revision = currentRevision + 1;
    const updatedAt = new Date().toISOString();
    const result = await createDeliveryDatabase(environment.DB)
      .insert(deployments)
      .values({
        appId: app,
        featureId: feature,
        runtimeVersion: selectedRuntimeVersion,
        bundleId: nextBundleId,
        enabled: nextEnabled,
        force: nextForce,
        revision,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: [deployments.appId, deployments.featureId, deployments.runtimeVersion],
        set: {
          bundleId: nextBundleId,
          enabled: nextEnabled,
          force: nextForce,
          revision,
          updatedAt,
        },
        where: eq(deployments.revision, currentRevision),
      })
      .run();
    if (Number(result.meta.changes ?? 0) !== 1) {
      throw new ApiError(409, 'deployment-conflict', 'Deployment changed concurrently; refresh and try again.');
    }
    return jsonResponse(200, await readOverview(environment, app, feature, selectedRuntimeVersion));
  });
}

export async function registerUpload(
  environment: ControlEnv,
  request: Request,
  release: ReleaseMetadata,
): Promise<Response> {
  return handleApiKeyRequest(environment, request, async () => {
    const app = release.appId ?? 'default';
    assertApp(app);
    const existing = await readBundle(environment, app, release.feature, release.releaseId);
    if (existing) {
      if (sameBundle(existing, release)) {
        return jsonResponse(200, { bundleId: release.releaseId, complete: true });
      }
      throw new ApiError(409, 'bundle-conflict', 'Bundle ID is already assigned to different immutable metadata.');
    }

    const key = archiveObjectKey(app, release.feature, release.releaseId);
    const head = await environment.ARTIFACTS.head(key);
    if (head) {
      await requireObject(environment.ARTIFACTS, key, release.archiveSha256, release.archiveBytes);
      return jsonResponse(200, {
        bundleId: release.releaseId,
        complete: false,
        uploaded: true,
      });
    }

    return jsonResponse(200, {
      bundleId: release.releaseId,
      complete: false,
      uploaded: false,
      ...(localUploadsEnabled(environment, request)
        ? {
            expiresIn: UPLOAD_EXPIRY_SECONDS,
            upload: await createLocalUploadInstruction(environment, request, key, release.archiveSha256),
          }
        : {}),
    });
  });
}

export async function completeUpload(
  environment: ControlEnv,
  request: Request,
  routeBundleId: string,
  release: ReleaseMetadata,
): Promise<Response> {
  return handleApiKeyRequest(environment, request, async () => {
    const app = release.appId ?? 'default';
    assertApp(app);
    if (!bundleId.test(routeBundleId)) {
      throw new ApiError(400, 'invalid-request', 'Bundle ID is invalid.');
    }
    if (release.releaseId !== routeBundleId) {
      throw new ApiError(409, 'bundle-conflict', 'Route bundle ID does not match release metadata.');
    }
    const existing = await readBundle(environment, app, release.feature, routeBundleId);
    if (existing) {
      if (sameBundle(existing, release)) return jsonResponse(200, { bundle: publicBundle(existing), created: false });
      throw new ApiError(409, 'bundle-conflict', 'Bundle ID is already assigned to different immutable metadata.');
    }

    await requireObject(
      environment.ARTIFACTS,
      archiveObjectKey(app, release.feature, release.releaseId),
      release.archiveSha256,
      release.archiveBytes,
    );
    const createdAt = new Date().toISOString();
    const result = await createDeliveryDatabase(environment.DB)
      .insert(bundles)
      .values({
        appId: app,
        id: release.releaseId,
        featureId: release.feature,
        version: release.version,
        runtimeVersion: release.runtimeVersion,
        archiveSha256: release.archiveSha256,
        archiveBytes: release.archiveBytes,
        createdAt,
      })
      .onConflictDoNothing()
      .run();
    if (Number(result.meta.changes ?? 0) !== 1) {
      throw new ApiError(409, 'bundle-conflict', 'Bundle completion raced with another request; retry it.');
    }
    const bundle = await readBundle(environment, app, release.feature, release.releaseId);
    if (!bundle) throw new Error('Inserted bundle could not be read.');
    return jsonResponse(201, { bundle: publicBundle(bundle), created: true });
  });
}

export async function login(
  environment: ControlEnv,
  request: Request,
  credentials: LoginInput,
): Promise<Response> {
  try {
    const user = await authenticatePassword(environment, credentials.username, credentials.password);
    if (!user) return unauthorized('Invalid username or password.');
    const secure = new URL(request.url).protocol === 'https:';
    return jsonResponse(200, { user }, { 'Set-Cookie': await createSessionCookie(environment, user, secure) });
  } catch (error) {
    if (error instanceof ApiError) return jsonResponse(error.status, { error: { code: error.code, message: error.message } });
    return jsonResponse(503, { error: { code: 'auth-not-configured', message: error instanceof Error ? error.message : 'Console authentication is unavailable.' } });
  }
}

export async function logout(environment: ControlEnv, request: Request): Promise<Response> {
  try {
    const secure = new URL(request.url).protocol === 'https:';
    return jsonResponse(204, null, { 'Set-Cookie': clearSessionCookie(secure) });
  } catch {
    return jsonResponse(204, null);
  }
}

export async function getCurrentUser(environment: ControlEnv, request: Request): Promise<Response> {
  try {
    const user = await authenticateSession(environment, request);
    return user ? jsonResponse(200, { user }) : unauthorized();
  } catch (error) {
    return jsonResponse(503, { error: { code: 'auth-not-configured', message: error instanceof Error ? error.message : 'Console authentication is unavailable.' } });
  }
}

/** Local Miniflare-only equivalent of the short-lived R2 PUT URL. */
export async function handleLocalUpload(
  environment: ControlEnv,
  request: Request,
  appOrFeature: string,
  featureOrReleaseId: string,
  maybeReleaseId?: string,
): Promise<Response> {
  if (request.method !== 'PUT' || !localUploadsEnabled(environment, request)) return notFound();
  try {
    const [app, feature] = maybeReleaseId ? [appOrFeature, featureOrReleaseId] : ['default', appOrFeature];
    const releaseId = maybeReleaseId ?? featureOrReleaseId;
    assertApp(app);
    assertFeature(feature);
    if (!bundleId.test(releaseId)) return notFound();
    const url = new URL(request.url);
    const expires = Number(url.searchParams.get('expires'));
    const digest = url.searchParams.get('sha256') ?? '';
    const signature = url.searchParams.get('signature') ?? '';
    if (!Number.isSafeInteger(expires) || expires < Date.now() || !sha256.test(digest)) return notFound();
    const key = archiveObjectKey(app, feature, releaseId);
    if (!(await matchesCapability(environment.AUTH_SESSION_SECRET, key, digest, expires, signature))) return notFound();
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

async function createLocalUploadInstruction(
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
  const expires = Date.now() + UPLOAD_EXPIRY_SECONDS * 1000;
  const secret = environment.AUTH_SESSION_SECRET?.trim();
  if (!secret) throw new ApiError(503, 'auth-not-configured', 'AUTH_SESSION_SECRET is required to create a local upload capability.');
  const signature = await createCapability(secret, key, expectedSha256, expires);
  const url = new URL(request.url);
  url.pathname = `/__local-r2/${key}`;
  url.search = '';
  url.searchParams.set('expires', String(expires));
  url.searchParams.set('sha256', expectedSha256);
  url.searchParams.set('signature', signature);
  return { method: 'PUT', url: url.toString(), headers };
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

async function readOverview(environment: ControlEnv, app: string, feature: string, runtimeVersion: string) {
  const database = createDeliveryDatabase(environment.DB);
  const [deployment, availableBundles] = await Promise.all([
    readDeployment(environment, app, feature, runtimeVersion),
    database.select().from(bundles).where(and(eq(bundles.appId, app), eq(bundles.featureId, feature), eq(bundles.runtimeVersion, runtimeVersion))).orderBy(desc(bundles.createdAt)).limit(50),
  ]);
  const selectedBundleId = deployment?.bundleId ?? null;
  const enabled = deployment?.enabled ?? false;
  return {
    deployment: {
      appId: app,
      feature,
      runtimeVersion,
      bundleId: selectedBundleId,
      enabled,
      force: deployment?.force ?? false,
      revision: deployment?.revision ?? 0,
      updatedAt: deployment?.updatedAt ?? null,
      status: enabled ? (selectedBundleId ? 'active' : 'empty') : 'disabled',
    },
    bundles: availableBundles.map((bundle) => ({
      ...publicBundle(bundle),
      status: bundle.id === selectedBundleId && enabled ? 'active' : 'ready',
    })),
  };
}

async function readDeployment(environment: ControlEnv, app: string, feature: string, runtimeVersion: string): Promise<DeploymentRow | null> {
  const [deployment] = await createDeliveryDatabase(environment.DB)
    .select()
    .from(deployments)
    .where(and(eq(deployments.appId, app), eq(deployments.featureId, feature), eq(deployments.runtimeVersion, runtimeVersion)))
    .limit(1);
  return deployment ?? null;
}

async function readBundle(environment: ControlEnv, app: string, feature: string, id: string): Promise<BundleRow | null> {
  const [bundle] = await createDeliveryDatabase(environment.DB)
    .select()
    .from(bundles)
    .where(and(eq(bundles.appId, app), eq(bundles.id, id)))
    .limit(1);
  return bundle?.featureId === feature ? bundle : null;
}

function publicBundle(bundle: BundleRow) {
  return {
    id: bundle.id,
    appId: bundle.appId,
    feature: bundle.featureId,
    version: bundle.version,
    runtimeVersion: bundle.runtimeVersion,
    archiveSha256: bundle.archiveSha256,
    archiveBytes: bundle.archiveBytes,
    createdAt: bundle.createdAt,
  };
}

function sameBundle(bundle: BundleRow, release: ReleaseMetadata): boolean {
  return bundle.appId === (release.appId ?? 'default')
    && bundle.featureId === release.feature
    && bundle.version === release.version
    && bundle.runtimeVersion === release.runtimeVersion
    && bundle.archiveSha256 === release.archiveSha256
    && bundle.archiveBytes === release.archiveBytes;
}

function archiveObjectKey(app: string, feature: string, id: string): string {
  return `${app}/${feature}/releases/${id}/release.zip`;
}

function normalizeUpdate(input: DeploymentUpdateInput): UpdateDeployment {
  const keys = Object.keys(input);
  if (keys.length === 1 && typeof input.enabled === 'boolean') return { enabled: input.enabled };
  if (keys.length === 2 && typeof input.bundleId === 'string' && typeof input.force === 'boolean') {
    return { bundleId: input.bundleId, force: input.force };
  }
  throw new ApiError(400, 'invalid-request', 'Deployment update is invalid.');
}

function assertFeature(feature: string): void {
  if (!featureId.test(feature)) throw new ApiError(400, 'invalid-request', 'Feature is invalid.');
}

function assertApp(value: string): void {
  if (!appId.test(value)) throw new ApiError(400, 'invalid-request', 'App ID is invalid.');
}

function requestRuntimeVersion(request: Request): string {
  const value = new URL(request.url).searchParams.get('runtimeVersion') ?? '';
  if (!runtimeVersion.test(value)) {
    throw new ApiError(400, 'invalid-request', 'runtimeVersion is required.');
  }
  return value;
}

function deploymentScope(appOrFeature: string, requestedFeature?: string): [string, string] {
  return requestedFeature ? [appOrFeature, requestedFeature] : ['default', appOrFeature];
}


async function handleConsoleRequest(environment: ControlEnv, request: Request, operation: () => Promise<Response>): Promise<Response> {
  try {
    if (!(await authenticateSession(environment, request))) return unauthorized();
    return await operation();
  } catch (error) {
    if (error instanceof ApiError) return jsonResponse(error.status, { error: { code: error.code, message: error.message } });
    return jsonResponse(500, { error: { code: 'internal-error', message: 'Request could not be completed.' } });
  }
}

async function handleApiKeyRequest(environment: ControlEnv, request: Request, operation: () => Promise<Response>): Promise<Response> {
  try {
    if (!(await authenticateApiKey(environment, request))) return unauthorized('A valid delivery API key is required.');
    return await operation();
  } catch (error) {
    if (error instanceof ApiError) return jsonResponse(error.status, { error: { code: error.code, message: error.message } });
    return jsonResponse(503, { error: { code: 'auth-not-configured', message: error instanceof Error ? error.message : 'CLI authentication is unavailable.' } });
  }
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

function unauthorized(message = 'Authentication is required.'): Response {
  return jsonResponse(401, { error: { code: 'unauthorized', message } });
}

function jsonResponse(status: number, value: unknown, headers?: HeadersInit): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
}
