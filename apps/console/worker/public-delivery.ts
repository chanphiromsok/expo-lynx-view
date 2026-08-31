export interface DeliveryEnv {
  ARTIFACTS: R2Bucket;
  DB: D1Database;
}

type DeploymentRow = {
  envelopeText: string;
  envelopeSha256: string;
};

type BundleRow = {
  manifestSha256: string;
  manifestBytes: number;
  archiveSha256: string;
  archiveBytes: number;
};

const featureId = /^[a-z][a-z0-9-]{0,63}$/;
const bundleId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const sha256 = /^[a-f0-9]{64}$/;
const deploymentCacheControl = 'no-cache';
const immutableCacheControl = 'public, max-age=31536000, immutable';

export async function handlePublicDeliveryRequest(
  environment: DeliveryEnv,
  request: Request,
): Promise<Response> {
  if (request.method !== 'GET') return notFound();

  try {
    const url = new URL(request.url);
    if (url.pathname === '/') {
      return jsonResponse(200, { service: 'lynx-delivery' });
    }
    if (url.pathname === '/health') {
      return jsonResponse(200, { ok: true, service: 'lynx-delivery' });
    }

    const parts = url.pathname.split('/').filter(Boolean).map(decodeSegment);
    if (parts.some((part) => part === undefined) || parts[0] !== 'v1') {
      return notFound();
    }
    if (parts[1] === 'deploy' && parts.length === 3) {
      const feature = parts[2];
      if (!feature || !featureId.test(feature)) return notFound();
      return getDeployment(environment, request, feature);
    }
    if (parts[1] === 'bundles' && parts.length === 5) {
      const feature = parts[2];
      const selectedBundle = parts[3];
      const artifact = parts[4];
      if (
        !feature ||
        !selectedBundle ||
        !featureId.test(feature) ||
        !bundleId.test(selectedBundle)
      ) {
        return notFound();
      }
      if (artifact === 'manifest') {
        return getArtifact(
          environment,
          request,
          feature,
          selectedBundle,
          'manifest',
        );
      }
      if (artifact === 'release.zip') {
        return getArtifact(
          environment,
          request,
          feature,
          selectedBundle,
          'archive',
        );
      }
    }
    return notFound();
  } catch {
    return unavailable();
  }
}

async function getDeployment(
  environment: DeliveryEnv,
  request: Request,
  feature: string,
): Promise<Response> {
  const row = await environment.DB.prepare(
    `SELECT envelope_text AS envelopeText, envelope_sha256 AS envelopeSha256
     FROM deployments
     WHERE feature_id = ? AND envelope_text IS NOT NULL
     LIMIT 1`,
  )
    .bind(feature)
    .first<DeploymentRow>();
  if (!row || !sha256.test(row.envelopeSha256)) return notFound();
  const etag = `"${row.envelopeSha256}"`;
  if (matchesIfNoneMatch(request, etag)) {
    return notModified(etag, deploymentCacheControl);
  }
  return new Response(row.envelopeText, {
    status: 200,
    headers: responseHeaders(
      'application/json; charset=utf-8',
      deploymentCacheControl,
      etag,
    ),
  });
}

async function getArtifact(
  environment: DeliveryEnv,
  request: Request,
  feature: string,
  selectedBundle: string,
  artifact: 'manifest' | 'archive',
): Promise<Response> {
  const row = await environment.DB.prepare(
    `SELECT
       manifest_sha256 AS manifestSha256, manifest_bytes AS manifestBytes,
       archive_sha256 AS archiveSha256, archive_bytes AS archiveBytes
     FROM bundles
     WHERE feature_id = ? AND id = ?
     LIMIT 1`,
  )
    .bind(feature, selectedBundle)
    .first<BundleRow>();
  if (!row) return notFound();

  const isManifest = artifact === 'manifest';
  const digest = isManifest ? row.manifestSha256 : row.archiveSha256;
  const expectedBytes = isManifest ? row.manifestBytes : row.archiveBytes;
  if (
    !sha256.test(digest) ||
    !Number.isSafeInteger(expectedBytes) ||
    expectedBytes <= 0
  ) {
    return unavailable();
  }
  const etag = `"${digest}"`;
  if (matchesIfNoneMatch(request, etag)) {
    return notModified(etag, immutableCacheControl);
  }

  const key = objectKey(feature, selectedBundle, artifact);
  const object = await environment.ARTIFACTS.get(key);
  if (!object || !object.body || object.size !== expectedBytes) return unavailable();

  const headers = responseHeaders(
    isManifest ? 'application/json; charset=utf-8' : 'application/zip',
    immutableCacheControl,
    etag,
  );
  headers.set('Accept-Ranges', 'none');
  headers.set(
    'Content-Disposition',
    isManifest
      ? 'inline; filename="release-envelope.json"'
      : 'attachment; filename="release.zip"',
  );
  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { status: 200, headers });
}

function objectKey(
  feature: string,
  selectedBundle: string,
  artifact: 'manifest' | 'archive',
): string {
  return `${feature}/releases/${selectedBundle}/${artifact === 'manifest' ? 'manifest.json' : 'release.zip'}`;
}

function decodeSegment(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function matchesIfNoneMatch(request: Request, etag: string): boolean {
  const value = request.headers.get('If-None-Match');
  if (!value) return false;
  return value.split(',').some((candidate) => {
    const normalized = candidate.trim();
    return normalized === '*' || normalized === etag || normalized === `W/${etag}`;
  });
}

function responseHeaders(
  contentType: string,
  cacheControl: string,
  etag: string,
): Headers {
  return new Headers({
    'Cache-Control': cacheControl,
    'Content-Type': contentType,
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
  });
}

function notModified(etag: string, cacheControl: string): Response {
  return new Response(null, {
    status: 304,
    headers: { 'Cache-Control': cacheControl, ETag: etag },
  });
}

function notFound(): Response {
  return jsonResponse(404, {
    error: { code: 'not-found', message: 'Resource was not found.' },
  });
}

function unavailable(): Response {
  return jsonResponse(503, {
    error: {
      code: 'artifact-unavailable',
      message: 'Release artifact is temporarily unavailable.',
    },
  });
}

function jsonResponse(status: number, value: unknown): Response {
  return Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
