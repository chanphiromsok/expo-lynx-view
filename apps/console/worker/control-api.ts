import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { Value } from '@sinclair/typebox/value';

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
  type AppCreateInput,
  type HostRuntimeRegistrationInput,
  type LoginInput,
  type MiniAppCreateInput,
  type MiniAppReleaseV2,
  type ReleaseMetadata,
  AppCreateSchema,
  HostRuntimeRegistrationSchema,
  MiniAppCreateSchema,
  MiniAppReleaseV2Schema,
  ReleaseMetadataSchema,
} from './schema.ts';
import { createDeliveryDatabase } from './db/client.ts';
import { apps, bundles, deployments, miniApps } from './db/schema.ts';

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
type AppRow = typeof apps.$inferSelect;
type UploadRelease = ReleaseMetadata | MiniAppReleaseV2;

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
        .where(isNotNull(bundles.verifiedAt))
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

export async function getApps(environment: ControlEnv, request: Request): Promise<Response> {
  return handleConsoleRequest(environment, request, async () => {
    const database = createDeliveryDatabase(environment.DB);
    const [registeredApps, registeredMiniApps] = await Promise.all([
      database.select().from(apps).orderBy(apps.name),
      database.select().from(miniApps).orderBy(miniApps.name),
    ]);
    return jsonResponse(200, registeredApps.map((app) => ({
      id: app.id,
      name: app.name,
      currentHostBuild: app.currentRuntimeVersion
        ? { appVersion: app.currentAppVersion, buildNumber: app.currentBuildNumber }
        : null,
      miniApps: registeredMiniApps
        .filter((miniApp) => miniApp.appId === app.id)
        .map((miniApp) => ({ id: miniApp.id, name: miniApp.name })),
    })));
  });
}

export async function createApp(
  environment: ControlEnv,
  request: Request,
  input: AppCreateInput,
): Promise<Response> {
  return handleConsoleRequest(environment, request, async () => {
    if (!Value.Check(AppCreateSchema, input) || !isDisplayName(input.name)) {
      throw new ApiError(400, 'invalid-request', 'App ID or name is invalid.');
    }
    const database = createDeliveryDatabase(environment.DB);
    const existing = await readApp(environment, input.id);
    if (existing) {
      if (existing.name === input.name) return jsonResponse(200, { app: publicApp(existing), created: false });
      throw new ApiError(409, 'app-conflict', 'An app with this ID already exists. IDs cannot be renamed.');
    }
    const createdAt = new Date().toISOString();
    await database.insert(apps).values({ id: input.id, name: input.name, createdAt }).run();
    const app = await readApp(environment, input.id);
    if (!app) throw new Error('Created app could not be read.');
    return jsonResponse(201, { app: publicApp(app), created: true });
  });
}

export async function createMiniApp(
  environment: ControlEnv,
  request: Request,
  app: string,
  input: MiniAppCreateInput,
): Promise<Response> {
  return handleConsoleRequest(environment, request, async () => {
    assertApp(app);
    if (!Value.Check(MiniAppCreateSchema, input) || !isDisplayName(input.name)) {
      throw new ApiError(400, 'invalid-request', 'Mini-app ID or name is invalid.');
    }
    if (!(await readApp(environment, app))) throw new ApiError(404, 'app-not-found', 'This app is not registered. Create it in the Console first.');
    const existing = await readMiniApp(environment, app, input.id);
    if (existing) {
      if (existing.name === input.name) return jsonResponse(200, { miniApp: publicMiniApp(existing), created: false });
      throw new ApiError(409, 'mini-app-conflict', 'A mini app with this ID already exists. IDs cannot be renamed.');
    }
    const createdAt = new Date().toISOString();
    await createDeliveryDatabase(environment.DB).insert(miniApps).values({ appId: app, id: input.id, name: input.name, createdAt }).run();
    const miniApp = await readMiniApp(environment, app, input.id);
    if (!miniApp) throw new Error('Created mini app could not be read.');
    return jsonResponse(201, { miniApp: publicMiniApp(miniApp), created: true });
  });
}

export async function registerHostRuntime(
  environment: ControlEnv,
  request: Request,
  app: string,
  input: HostRuntimeRegistrationInput,
): Promise<Response> {
  return handleApiKeyRequest(environment, request, async () => {
    assertApp(app);
    if (!Value.Check(HostRuntimeRegistrationSchema, input) || !hasPrintableText(input.runtimeVersion) || !hasPrintableText(input.appVersion) || !hasPrintableText(input.buildNumber)) {
      throw new ApiError(400, 'invalid-request', 'Host runtime registration is invalid.');
    }
    const registeredApp = await readApp(environment, app);
    if (!registeredApp) throw new ApiError(404, 'app-not-found', 'This app is not registered. Ask the Console operator to create it first.');
    const registeredMiniApps = await createDeliveryDatabase(environment.DB)
      .select({ id: miniApps.id })
      .from(miniApps)
      .where(eq(miniApps.appId, app));
    const expected = registeredMiniApps.map(({ id }) => id).sort();
    const supplied = [...input.features].sort();
    if (expected.length !== supplied.length || expected.some((id, index) => id !== supplied[index])) {
      throw new ApiError(409, 'mini-app-mismatch', 'The host feature list does not match this app’s registered mini apps. Update the Console registration before registering the host build.');
    }
    if (registeredApp.currentRuntimeVersion === input.runtimeVersion) {
      if (registeredApp.currentAppVersion !== input.appVersion || registeredApp.currentBuildNumber !== input.buildNumber) {
        throw new ApiError(409, 'host-runtime-conflict', 'This runtime is already registered with a different app version or build number.');
      }
      return jsonResponse(200, { app: publicApp(registeredApp), created: false });
    }
    const updatedAt = new Date().toISOString();
    const statements = [
      environment.DB.prepare(
        'UPDATE apps SET current_runtime_version = ?, current_app_version = ?, current_build_number = ? WHERE id = ?',
      ).bind(input.runtimeVersion, input.appVersion, input.buildNumber, app),
      ...supplied.map((feature) => environment.DB.prepare(
        // A missing runtime is represented publicly as signed disabled revision 1.
        // Start the durable row after it so mobile never observes a changed
        // document at the same revision after host registration.
        'INSERT OR IGNORE INTO deployments (app_id, feature_id, runtime_version, bundle_id, enabled, force, revision, updated_at) VALUES (?, ?, ?, NULL, 0, 0, 2, ?)',
      ).bind(app, feature, input.runtimeVersion, updatedAt)),
    ];
    await environment.DB.batch(statements);
    const updated = await readApp(environment, app);
    if (!updated) throw new Error('Registered app could not be read.');
    return jsonResponse(200, { app: publicApp(updated), created: true });
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
      if (!bundle.verifiedAt) throw new ApiError(409, 'bundle-not-ready', 'Wait for the R2 upload to be verified before selecting this bundle.');
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
  input: unknown,
): Promise<Response> {
  return handleApiKeyRequest(environment, request, async () => {
    const release = parseUploadRelease(input);
    const app = releaseAppId(release);
    assertApp(app);
    assertFeature(release.feature);
    const registeredApp = await readApp(environment, app);
    if (!registeredApp && release.schemaVersion === 2) {
      throw new ApiError(404, 'app-not-found', 'This app is not registered. Ask the Console operator to create it first.');
    }
    if (registeredApp && !(await readMiniApp(environment, app, release.feature))) {
      throw new ApiError(404, 'mini-app-not-found', 'This mini app is not registered. Ask the Console operator to create it first.');
    }
    const targetRuntime = release.schemaVersion === 1
      ? release.runtimeVersion
      : registeredApp?.currentRuntimeVersion;
    if (!targetRuntime) {
      throw new ApiError(409, 'host-runtime-not-registered', `${registeredApp?.name ?? app} has no registered current host build. Ask the host team to run lynx host register.`);
    }
    if (release.schemaVersion === 2) assertExpectedHostBuild(request, registeredApp!);
    const existing = await readBundle(environment, app, release.feature, release.releaseId);
    if (existing) {
      if (sameBundle(existing, release)) {
        return jsonResponse(200, uploadState(existing, registeredApp, await objectUploaded(environment, app, release)));
      }
      throw new ApiError(409, 'bundle-conflict', 'Bundle ID is already assigned to different immutable metadata.');
    }

    const createdAt = new Date().toISOString();
    const inserted = await createDeliveryDatabase(environment.DB)
      .insert(bundles)
      .values({
        appId: app,
        id: release.releaseId,
        featureId: release.feature,
        version: release.version,
        runtimeVersion: targetRuntime,
        archiveSha256: release.archiveSha256,
        archiveBytes: release.archiveBytes,
        verifiedAt: null,
        targetAppVersion: registeredApp?.currentAppVersion ?? null,
        targetBuildNumber: registeredApp?.currentBuildNumber ?? null,
        createdAt,
      })
      .onConflictDoNothing()
      .run();
    if (Number(inserted.meta.changes ?? 0) !== 1) {
      const raced = await readBundle(environment, app, release.feature, release.releaseId);
      if (!raced || !sameBundle(raced, release)) {
        throw new ApiError(409, 'bundle-conflict', 'Bundle ID is already assigned to different immutable metadata.');
      }
      return jsonResponse(200, uploadState(raced, registeredApp, await objectUploaded(environment, app, release)));
    }

    const key = archiveObjectKey(app, release.feature, release.releaseId);
    const uploaded = await objectUploaded(environment, app, release);
    return jsonResponse(200, {
      ...uploadState({
        appId: app,
        id: release.releaseId,
        featureId: release.feature,
        version: release.version,
        runtimeVersion: targetRuntime,
        archiveSha256: release.archiveSha256,
        archiveBytes: release.archiveBytes,
        verifiedAt: null,
        targetAppVersion: registeredApp?.currentAppVersion ?? null,
        targetBuildNumber: registeredApp?.currentBuildNumber ?? null,
        createdAt,
      }, registeredApp, uploaded),
      ...(localUploadsEnabled(environment, request)
        && !uploaded ? {
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
  input: unknown,
): Promise<Response> {
  return handleApiKeyRequest(environment, request, async () => {
    const release = parseUploadRelease(input);
    const app = releaseAppId(release);
    assertApp(app);
    if (!bundleId.test(routeBundleId)) {
      throw new ApiError(400, 'invalid-request', 'Bundle ID is invalid.');
    }
    if (release.releaseId !== routeBundleId) {
      throw new ApiError(409, 'bundle-conflict', 'Route bundle ID does not match release metadata.');
    }
    const existing = await readBundle(environment, app, release.feature, routeBundleId);
    if (!existing) throw new ApiError(404, 'artifact-not-found', 'This release was not reserved. Run lynx release upload again.');
    if (!sameBundle(existing, release)) throw new ApiError(409, 'bundle-conflict', 'Bundle ID is already assigned to different immutable metadata.');
    if (existing.verifiedAt) return jsonResponse(200, { bundle: publicBundle(existing), created: false });

    await requireObject(
      environment.ARTIFACTS,
      archiveObjectKey(app, release.feature, release.releaseId),
      release.archiveSha256,
      release.archiveBytes,
    );
    const result = await createDeliveryDatabase(environment.DB)
      .update(bundles)
      .set({ verifiedAt: new Date().toISOString() })
      .where(and(eq(bundles.appId, app), eq(bundles.id, release.releaseId), isNull(bundles.verifiedAt)))
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
  const secure = new URL(request.url).protocol === 'https:';
  return new Response(null, {
    status: 204,
    headers: { 'Set-Cookie': clearSessionCookie(secure) },
  });
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
    database.select().from(bundles).where(and(
      eq(bundles.appId, app),
      eq(bundles.featureId, feature),
      eq(bundles.runtimeVersion, runtimeVersion),
      isNotNull(bundles.verifiedAt),
    )).orderBy(desc(bundles.createdAt)).limit(50),
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

async function readApp(environment: ControlEnv, id: string): Promise<AppRow | null> {
  const [app] = await createDeliveryDatabase(environment.DB)
    .select()
    .from(apps)
    .where(eq(apps.id, id))
    .limit(1);
  return app ?? null;
}

async function readMiniApp(environment: ControlEnv, app: string, id: string) {
  const [miniApp] = await createDeliveryDatabase(environment.DB)
    .select()
    .from(miniApps)
    .where(and(eq(miniApps.appId, app), eq(miniApps.id, id)))
    .limit(1);
  return miniApp ?? null;
}

function publicApp(app: AppRow) {
  return {
    id: app.id,
    name: app.name,
    currentHostBuild: app.currentRuntimeVersion
      ? { appVersion: app.currentAppVersion, buildNumber: app.currentBuildNumber }
      : null,
  };
}

function publicMiniApp(miniApp: typeof miniApps.$inferSelect) {
  return { appId: miniApp.appId, id: miniApp.id, name: miniApp.name };
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
    verifiedAt: bundle.verifiedAt,
    targetAppVersion: bundle.targetAppVersion,
    targetBuildNumber: bundle.targetBuildNumber,
    createdAt: bundle.createdAt,
  };
}

function sameBundle(bundle: BundleRow, release: UploadRelease): boolean {
  return bundle.appId === releaseAppId(release)
    && bundle.featureId === release.feature
    && bundle.version === release.version
    && bundle.archiveSha256 === release.archiveSha256
    && bundle.archiveBytes === release.archiveBytes
    && (release.schemaVersion === 2 || bundle.runtimeVersion === release.runtimeVersion);
}

function parseUploadRelease(input: unknown): UploadRelease {
  if (Value.Check(MiniAppReleaseV2Schema, input)) {
    const release = input as MiniAppReleaseV2;
    if (!hasPrintableText(release.version)) throw new ApiError(400, 'invalid-request', 'Release version contains unsupported characters.');
    return release;
  }
  if (Value.Check(ReleaseMetadataSchema, input)) {
    const release = input as ReleaseMetadata;
    if (!hasPrintableText(release.version) || !hasPrintableText(release.runtimeVersion)) {
      throw new ApiError(400, 'invalid-request', 'Release metadata contains unsupported characters.');
    }
    return release;
  }
  throw new ApiError(400, 'invalid-request', 'Release metadata is invalid.');
}

function releaseAppId(release: UploadRelease): string {
  return release.schemaVersion === 1 ? release.appId ?? 'default' : release.appId;
}

async function objectUploaded(environment: ControlEnv, app: string, release: UploadRelease): Promise<boolean> {
  return Boolean(await environment.ARTIFACTS.head(archiveObjectKey(app, release.feature, release.releaseId)));
}

function uploadState(bundle: BundleRow, app: AppRow | null, uploaded: boolean) {
  return {
    schemaVersion: 2,
    bundleId: bundle.id,
    target: {
      appId: bundle.appId,
      feature: bundle.featureId,
      appVersion: bundle.targetAppVersion,
      buildNumber: bundle.targetBuildNumber,
    },
    complete: Boolean(bundle.verifiedAt),
    uploaded,
  };
}

function assertExpectedHostBuild(request: Request, app: AppRow): void {
  const expected = request.headers.get('lynx-expected-host-build');
  if (!expected) return;
  if (!hasPrintableText(expected) || expected !== app.currentBuildNumber) {
    throw new ApiError(409, 'host-build-mismatch', `The current host build is ${app.currentBuildNumber ?? 'not labelled'}. Update the mini-app release target before uploading.`);
  }
}

function hasPrintableText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\x00-\x1f\x7f]/.test(value);
}

function isDisplayName(value: unknown): value is string {
  return hasPrintableText(value) && value.trim().length > 0;
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
