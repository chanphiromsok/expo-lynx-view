import { and, eq, isNotNull } from 'drizzle-orm';

import { sha256Hex, signDocument } from './protocol.ts';
import { createDeliveryDatabase } from './db/client.ts';
import { bundles, deployments } from './db/schema.ts';

export interface DeliveryEnv {
  ARTIFACTS: R2Bucket;
  DB: D1Database;
  DELIVERY_SIGNING_PRIVATE_KEY: string;
}

type DeploymentRow = typeof deployments.$inferSelect & Partial<Pick<typeof bundles.$inferSelect,
  'version' | 'runtimeVersion' | 'archiveSha256' | 'archiveBytes'>>;

const featureId = /^[a-z][a-z0-9-]{0,63}$/;
const appId = /^[a-z][a-z0-9-]{0,63}$/;
const bundleId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const sha256 = /^[a-f0-9]{64}$/;
const runtimeVersion = /^[\u0020-\u007e]{1,128}$/;
const immutableCacheControl = 'public, max-age=31536000, immutable';

export async function handlePublicDeliveryRequest(
  environment: DeliveryEnv,
  request: Request,
): Promise<Response> {
  if (request.method !== 'GET') return notFound();
  try {
    const url = new URL(request.url);
    if (url.pathname === '/') return jsonResponse(200, { service: 'lynx-delivery' });
    if (url.pathname === '/health') return jsonResponse(200, { ok: true, service: 'lynx-delivery' });

    const parts = url.pathname.split('/').filter(Boolean).map(decodeSegment);
    if (parts.some((part) => part === undefined) || parts[0] !== 'v1') return notFound();
    if (parts[1] === 'deploy' && parts.length === 3) {
      const feature = parts[2];
      if (!feature || !featureId.test(feature)) return notFound();
      return getDeployment(environment, request, 'default', feature, false);
    }
    if (parts[1] === 'bundles' && parts.length === 5 && parts[4] === 'release.zip') {
      const feature = parts[2];
      const releaseId = parts[3];
      if (!feature || !releaseId || !featureId.test(feature) || !bundleId.test(releaseId)) return notFound();
      return getArchive(environment, request, 'default', feature, releaseId);
    }
    if (parts.length === 3) {
      const [app, feature] = [parts[1], parts[2]];
      if (!app || !feature || !appId.test(app) || !featureId.test(feature)) return notFound();
      return getDeployment(environment, request, app, feature, true);
    }
    if (parts.length === 5 && parts[4] === 'release.zip') {
      const [app, feature, releaseId] = [parts[1], parts[2], parts[3]];
      if (!app || !feature || !releaseId || !appId.test(app) || !featureId.test(feature) || !bundleId.test(releaseId)) return notFound();
      return getArchive(environment, request, app, feature, releaseId);
    }
    return notFound();
  } catch {
    return unavailable();
  }
}

async function getDeployment(
  environment: DeliveryEnv,
  request: Request,
  app: string,
  feature: string,
  scopedRoute: boolean,
): Promise<Response> {
  if (!environment.DELIVERY_SIGNING_PRIVATE_KEY?.trim()) {
    return jsonResponse(503, { error: { code: 'signing-not-configured', message: 'Delivery signing is unavailable.' } });
  }
  const requestedRuntime = request.headers.get('lynx-runtime-version');
  if (requestedRuntime !== null && !runtimeVersion.test(requestedRuntime)) {
    return jsonResponse(400, { error: { code: 'runtime-version-required', message: 'lynx-runtime-version is required.' } });
  }
  const database = createDeliveryDatabase(environment.DB);
  const matchingDeployments = requestedRuntime === null
    ? await database.select().from(deployments)
      .where(and(eq(deployments.appId, app), eq(deployments.featureId, feature)))
      .limit(2)
    : await database.select().from(deployments)
      .where(and(
        eq(deployments.appId, app),
        eq(deployments.featureId, feature),
        eq(deployments.runtimeVersion, requestedRuntime),
      ))
      .limit(1);
  // ponytail: support pre-runtime-header apps only while their deployment is
  // unambiguous; remove this branch after the supported mobile-version floor moves.
  if (requestedRuntime === null && matchingDeployments.length > 1) {
    return jsonResponse(409, { error: { code: 'legacy-runtime-ambiguous', message: 'This app version must upgrade before delivery can select a runtime.' } });
  }
  const [deployment] = matchingDeployments;
  const bundleFilter = requestedRuntime === null
    ? and(
      eq(bundles.appId, app),
      eq(bundles.featureId, feature),
      eq(bundles.id, deployment?.bundleId ?? ''),
      isNotNull(bundles.verifiedAt),
    )
    : and(
      eq(bundles.appId, app),
      eq(bundles.featureId, feature),
      eq(bundles.runtimeVersion, requestedRuntime),
      eq(bundles.id, deployment?.bundleId ?? ''),
      isNotNull(bundles.verifiedAt),
    );
  const [bundle] = deployment?.bundleId
    ? await database.select().from(bundles).where(bundleFilter).limit(1)
    : [];
  const row: DeploymentRow | null = deployment
    ? (bundle ? { ...deployment, ...bundle } : deployment)
    : null;
  const document = deploymentDocument(feature, requestedRuntime ?? undefined, row, app, scopedRoute);
  if (!document) return unavailable();
  try {
    const signed = await signDocument(document, environment.DELIVERY_SIGNING_PRIVATE_KEY);
    // The deployment body is deterministic for one D1 revision. Its ETag lets
    // clients distinguish a harmless repeated check from an invalid mutation
    // of the deployment at the same revision.
    const etag = `"${await sha256Hex(signed.body)}"`;
    if (matchesIfNoneMatch(request, etag)) return notModified(etag, 'no-store');
    return new Response(signed.body, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
        ETag: etag,
        'Lynx-Signature': signed.signature,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return jsonResponse(503, { error: { code: 'signing-not-configured', message: 'Delivery signing is unavailable.' } });
  }
}

function deploymentDocument(feature: string, runtimeVersion: string | undefined, row: DeploymentRow | null, app: string, scopedRoute: boolean): Record<string, unknown> | null {
  if (!row || !row.enabled) {
    return {
      schemaVersion: 1,
      type: 'lynx-deployment',
      feature,
      revision: Math.max(1, row?.revision ?? 0),
      enabled: false,
      ...(runtimeVersion ? { runtimeVersion } : {}),
      issuedAt: row?.updatedAt ?? new Date(0).toISOString(),
    };
  }
  const archiveBytes = row?.archiveBytes;
  if (
    !row.bundleId || !row.version || !row.runtimeVersion || !row.archiveSha256 ||
    !sha256.test(row.archiveSha256) || typeof archiveBytes !== 'number' || !Number.isSafeInteger(archiveBytes) || archiveBytes <= 0
  ) return null;
  return {
    schemaVersion: 1,
    type: 'lynx-deployment',
    feature,
    revision: row.revision,
    enabled: true,
    force: row.force,
    releaseId: row.bundleId,
    version: row.version,
    runtimeVersion: row.runtimeVersion,
    archiveUrl: scopedRoute
      ? `/v1/${encodeURIComponent(app)}/${encodeURIComponent(feature)}/${encodeURIComponent(row.bundleId)}/release.zip`
      : `/v1/bundles/${encodeURIComponent(feature)}/${encodeURIComponent(row.bundleId)}/release.zip`,
    archiveSha256: row.archiveSha256,
    archiveBytes,
    issuedAt: row.updatedAt,
  };
}

async function getArchive(
  environment: DeliveryEnv,
  request: Request,
  app: string,
  feature: string,
  releaseId: string,
): Promise<Response> {
  const [row] = await createDeliveryDatabase(environment.DB)
    .select()
    .from(bundles)
    .where(and(
      eq(bundles.appId, app),
      eq(bundles.featureId, feature),
      eq(bundles.id, releaseId),
      isNotNull(bundles.verifiedAt),
    ))
    .limit(1);
  if (!row) return notFound();
  if (!sha256.test(row.archiveSha256) || !Number.isSafeInteger(row.archiveBytes) || row.archiveBytes <= 0) {
    return unavailable();
  }
  const etag = `"${row.archiveSha256}"`;
  if (matchesIfNoneMatch(request, etag)) return notModified(etag);
  const object = await environment.ARTIFACTS.get(archiveObjectKey(app, feature, releaseId))
    // D1 rows from before 0003 are migrated into `default`; their immutable R2
    // objects keep the old key until a later retention cleanup.
    ?? (app === 'default' ? await environment.ARTIFACTS.get(legacyArchiveObjectKey(feature, releaseId)) : null);
  if (!object?.body || object.size !== row.archiveBytes) return unavailable();
  return new Response(object.body, {
    status: 200,
    headers: {
      'Accept-Ranges': 'none',
      'Cache-Control': immutableCacheControl,
      'Content-Disposition': 'attachment; filename="release.zip"',
      'Content-Length': String(object.size),
      'Content-Type': 'application/zip',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function archiveObjectKey(app: string, feature: string, releaseId: string): string {
  return `${app}/${feature}/releases/${releaseId}/release.zip`;
}

function legacyArchiveObjectKey(feature: string, releaseId: string): string {
  return `${feature}/releases/${releaseId}/release.zip`;
}

function decodeSegment(value: string): string | undefined {
  try { return decodeURIComponent(value); } catch { return undefined; }
}

function matchesIfNoneMatch(request: Request, etag: string): boolean {
  const value = request.headers.get('If-None-Match');
  return value?.split(',').some((candidate) => {
    const normalized = candidate.trim();
    return normalized === '*' || normalized === etag || normalized === `W/${etag}`;
  }) ?? false;
}

function notModified(etag: string, cacheControl = immutableCacheControl): Response {
  return new Response(null, { status: 304, headers: { 'Cache-Control': cacheControl, ETag: etag } });
}

function notFound(): Response {
  return jsonResponse(404, { error: { code: 'not-found', message: 'Resource was not found.' } });
}

function unavailable(): Response {
  return jsonResponse(503, { error: { code: 'artifact-unavailable', message: 'Release artifact is temporarily unavailable.' } });
}

function jsonResponse(status: number, value: unknown): Response {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
