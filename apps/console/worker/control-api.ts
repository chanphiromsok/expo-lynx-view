import type { DeploymentPayload } from '../../../packages/expo-lynx/src/ReleaseProtocol.ts';

import { hexToBase64, sha256Hex, signDeployment, verifyReleaseEnvelope } from './protocol.ts';
import { presignR2Put } from './r2-presign.ts';

export interface ControlEnv {
  ARTIFACTS: R2Bucket;
  DB: D1Database;
  CONTROL_TOKEN: string;
  DEPLOYMENT_PRIVATE_KEY: string;
  PUBLIC_BASE_URL: string;
  RELEASE_PUBLIC_KEY: string;
  R2_ACCESS_KEY_ID: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
  R2_SECRET_ACCESS_KEY: string;
}

export type UpdateDeployment =
  | { enabled: boolean }
  | { bundleId: string; force: boolean };

type BundleRow = {
  id: string;
  featureId: string;
  version: string;
  manifestSha256: string;
  manifestBytes: number;
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
  envelopeText: string | null;
  envelopeSha256: string | null;
  updatedAt: string;
};

class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
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
  return handleControlRequest(environment, request, async () =>
    jsonResponse(200, await readOverview(environment, feature)),
  );
}

export async function updateDeployment(
  environment: ControlEnv,
  request: Request,
  feature: string,
  update: UpdateDeployment,
): Promise<Response> {
  return handleControlRequest(environment, request, async () => {
    const current = await readDeployment(environment, feature);
    const enabled = current?.enabled === 1;
    const currentBundleId = current?.bundleId ?? null;
    const currentRevision = current?.revision ?? 0;

    let nextEnabled = enabled;
    let nextBundleId = currentBundleId;
    let nextForce = false;
    let changed = false;

    if ('enabled' in update) {
      if (update.enabled === enabled) {
        return jsonResponse(200, await readOverview(environment, feature));
      }
      if (update.enabled && !currentBundleId) {
        throw new ApiError(
          409,
          'deployment-empty',
          'Select a verified bundle before enabling delivery.',
        );
      }
      nextEnabled = update.enabled;
      changed = true;
    } else {
      const bundle = await readBundle(environment, feature, update.bundleId);
      if (!bundle) {
        throw new ApiError(404, 'bundle-not-found', 'Verified bundle was not found.');
      }
      if (currentBundleId === bundle.id && !update.force) {
        return jsonResponse(200, await readOverview(environment, feature));
      }
      nextBundleId = bundle.id;
      nextForce = update.force;
      changed = currentBundleId !== bundle.id || update.force;
    }

    if (!changed) return jsonResponse(200, await readOverview(environment, feature));

    const revision = currentRevision + 1;
    const issuedAt = new Date().toISOString();
    const payload = await deploymentPayload(
      environment,
      feature,
      nextBundleId,
      nextEnabled,
      nextForce,
      revision,
      issuedAt,
    );
    const signed = await signDeployment(payload, environment.DEPLOYMENT_PRIVATE_KEY);
    const result = await environment.DB.prepare(
      `INSERT INTO deployments (
        feature_id, bundle_id, enabled, force, revision,
        envelope_text, envelope_sha256, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(feature_id) DO UPDATE SET
        bundle_id = excluded.bundle_id,
        enabled = excluded.enabled,
        force = excluded.force,
        revision = excluded.revision,
        envelope_text = excluded.envelope_text,
        envelope_sha256 = excluded.envelope_sha256,
        updated_at = excluded.updated_at
      WHERE deployments.revision = ?`,
    )
      .bind(
        feature,
        nextBundleId,
        nextEnabled ? 1 : 0,
        nextForce ? 1 : 0,
        revision,
        signed.envelopeText,
        signed.envelopeSha256,
        issuedAt,
        currentRevision,
      )
      .run();
    if (Number(result.meta.changes ?? 0) !== 1) {
      throw new ApiError(
        409,
        'deployment-conflict',
        'Deployment changed concurrently; refresh and try again.',
      );
    }
    return jsonResponse(200, await readOverview(environment, feature));
  });
}

export async function registerUpload(
  environment: ControlEnv,
  request: Request,
  envelopeText: string,
): Promise<Response> {
  return handleControlRequest(environment, request, async () => {
    const verified = await verifyReleaseEnvelope(
      envelopeText,
      environment.RELEASE_PUBLIC_KEY,
    );
    const { payload } = verified;
    const existing = await readBundle(environment, payload.feature, payload.releaseId);
    if (existing) {
      if (
        existing.manifestSha256 === verified.envelopeSha256 &&
        existing.manifestBytes === verified.envelopeBytes.byteLength &&
        existing.archiveSha256 === payload.archive.sha256 &&
        existing.archiveBytes === payload.archive.bytes
      ) {
        return jsonResponse(200, { bundleId: payload.releaseId, complete: true });
      }
      throw new ApiError(
        409,
        'bundle-conflict',
        'Bundle ID is already assigned to different immutable bytes.',
      );
    }

    const manifestKey = objectKey(payload.feature, payload.releaseId, 'manifest');
    const archiveKey = objectKey(payload.feature, payload.releaseId, 'archive');
    const configuration = {
      accountId: environment.R2_ACCOUNT_ID,
      accessKeyId: environment.R2_ACCESS_KEY_ID,
      secretAccessKey: environment.R2_SECRET_ACCESS_KEY,
      bucketName: environment.R2_BUCKET_NAME,
    };
    const [manifest, archive] = await Promise.all([
      prepareUpload(
        environment,
        configuration,
        manifestKey,
        'application/json',
        verified.envelopeSha256,
        verified.envelopeBytes.byteLength,
      ),
      prepareUpload(
        environment,
        configuration,
        archiveKey,
        'application/zip',
        payload.archive.sha256,
        payload.archive.bytes,
      ),
    ]);
    return jsonResponse(200, {
      bundleId: payload.releaseId,
      complete: false,
      expiresIn: 900,
      uploads: { manifest, archive },
    });
  });
}

export async function completeUpload(
  environment: ControlEnv,
  request: Request,
  bundleId: string,
  envelopeText: string,
): Promise<Response> {
  return handleControlRequest(environment, request, async () => {
    const verified = await verifyReleaseEnvelope(
      envelopeText,
      environment.RELEASE_PUBLIC_KEY,
    );
    const { payload } = verified;
    if (payload.releaseId !== bundleId) {
      throw new ApiError(
        409,
        'bundle-identity-mismatch',
        'Route bundle ID does not match the signed release.',
      );
    }

    const existing = await readBundle(environment, payload.feature, bundleId);
    if (existing) {
      if (
        existing.manifestSha256 === verified.envelopeSha256 &&
        existing.manifestBytes === verified.envelopeBytes.byteLength &&
        existing.archiveSha256 === payload.archive.sha256 &&
        existing.archiveBytes === payload.archive.bytes
      ) {
        return jsonResponse(200, { bundle: publicBundle(existing), created: false });
      }
      throw new ApiError(
        409,
        'bundle-conflict',
        'Bundle ID is already assigned to different immutable bytes.',
      );
    }

    const manifestKey = objectKey(payload.feature, bundleId, 'manifest');
    const archiveKey = objectKey(payload.feature, bundleId, 'archive');
    await Promise.all([
      requireObject(
        environment.ARTIFACTS,
        manifestKey,
        verified.envelopeSha256,
        verified.envelopeBytes.byteLength,
      ),
      requireObject(
        environment.ARTIFACTS,
        archiveKey,
        payload.archive.sha256,
        payload.archive.bytes,
      ),
    ]);

    const createdAt = new Date().toISOString();
    const result = await environment.DB.prepare(
      `INSERT INTO bundles (
        id, feature_id, version, manifest_sha256, manifest_bytes,
        archive_sha256, archive_bytes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING`,
    )
      .bind(
        bundleId,
        payload.feature,
        payload.version,
        verified.envelopeSha256,
        verified.envelopeBytes.byteLength,
        payload.archive.sha256,
        payload.archive.bytes,
        createdAt,
      )
      .run();
    if (Number(result.meta.changes ?? 0) !== 1) {
      throw new ApiError(
        409,
        'bundle-conflict',
        'Bundle completion raced with another request; retry to inspect it.',
      );
    }
    const bundle = await readBundle(environment, payload.feature, bundleId);
    if (!bundle) throw new Error('Inserted bundle could not be read.');
    return jsonResponse(201, { bundle: publicBundle(bundle), created: true });
  });
}

async function deploymentPayload(
  environment: ControlEnv,
  feature: string,
  bundleId: string | null,
  enabled: boolean,
  force: boolean,
  revision: number,
  issuedAt: string,
): Promise<DeploymentPayload> {
  if (!enabled) {
    return { type: 'lynx-deployment', feature, revision, enabled: false, issuedAt };
  }
  if (!bundleId) throw new ApiError(409, 'deployment-empty', 'Deployment has no bundle.');
  const bundle = await readBundle(environment, feature, bundleId);
  if (!bundle) throw new ApiError(404, 'bundle-not-found', 'Verified bundle was not found.');
  const base = new URL(environment.PUBLIC_BASE_URL);
  const manifestUrl = new URL(
    `/v1/bundles/${encodeURIComponent(feature)}/${encodeURIComponent(bundleId)}/manifest`,
    base,
  ).toString();
  return {
    type: 'lynx-deployment',
    feature,
    revision,
    enabled: true,
    releaseId: bundleId,
    manifestUrl,
    manifestSha256: bundle.manifestSha256,
    force,
    issuedAt,
  };
}

async function prepareUpload(
  environment: ControlEnv,
  configuration: Parameters<typeof presignR2Put>[0],
  key: string,
  contentType: string,
  expectedSha256: string,
  expectedBytes: number,
) {
  const existing = await environment.ARTIFACTS.head(key);
  if (existing) {
    await requireObject(
      environment.ARTIFACTS,
      key,
      expectedSha256,
      expectedBytes,
    );
    return { uploaded: true, url: null, headers: {} };
  }
  const signed = await presignR2Put(
    configuration,
    key,
    contentType,
    hexToBase64(expectedSha256),
  );
  return { uploaded: false, ...signed };
}

async function requireObject(
  bucket: R2Bucket,
  key: string,
  expectedSha256: string,
  expectedBytes: number,
): Promise<void> {
  const head = await bucket.head(key);
  if (!head || head.size !== expectedBytes) {
    throw new ApiError(
      409,
      'upload-incomplete',
      'Uploaded object is missing or has the wrong byte length.',
    );
  }
  const checksum = head.checksums.sha256;
  let digest: string;
  if (checksum) {
    digest = Array.from(new Uint8Array(checksum), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
  } else {
    const object = await bucket.get(key);
    if (!object || !('arrayBuffer' in object)) {
      throw new ApiError(409, 'upload-incomplete', 'Uploaded object is unavailable.');
    }
    digest = await sha256Hex(new Uint8Array(await object.arrayBuffer()));
  }
  if (digest !== expectedSha256) {
    throw new ApiError(
      409,
      'upload-checksum-mismatch',
      'Uploaded object does not match the signed SHA-256.',
    );
  }
}

async function readOverview(environment: ControlEnv, feature: string) {
  const [deployment, bundlesResult] = await Promise.all([
    readDeployment(environment, feature),
    environment.DB.prepare(
      `SELECT
        id, feature_id AS featureId, version,
        manifest_sha256 AS manifestSha256, manifest_bytes AS manifestBytes,
        archive_sha256 AS archiveSha256, archive_bytes AS archiveBytes,
        created_at AS createdAt
      FROM bundles
      WHERE feature_id = ?
      ORDER BY created_at DESC
      LIMIT 50`,
    )
      .bind(feature)
      .all<BundleRow>(),
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

async function readDeployment(
  environment: ControlEnv,
  feature: string,
): Promise<DeploymentRow | null> {
  return environment.DB.prepare(
    `SELECT
      feature_id AS featureId, bundle_id AS bundleId, enabled, force, revision,
      envelope_text AS envelopeText, envelope_sha256 AS envelopeSha256,
      updated_at AS updatedAt
    FROM deployments WHERE feature_id = ? LIMIT 1`,
  )
    .bind(feature)
    .first<DeploymentRow>();
}

async function readBundle(
  environment: ControlEnv,
  feature: string,
  bundleId: string,
): Promise<BundleRow | null> {
  return environment.DB.prepare(
    `SELECT
      id, feature_id AS featureId, version,
      manifest_sha256 AS manifestSha256, manifest_bytes AS manifestBytes,
      archive_sha256 AS archiveSha256, archive_bytes AS archiveBytes,
      created_at AS createdAt
    FROM bundles WHERE feature_id = ? AND id = ? LIMIT 1`,
  )
    .bind(feature, bundleId)
    .first<BundleRow>();
}

function publicBundle(bundle: BundleRow) {
  return {
    id: bundle.id,
    feature: bundle.featureId,
    version: bundle.version,
    manifestSha256: bundle.manifestSha256,
    manifestBytes: bundle.manifestBytes,
    archiveSha256: bundle.archiveSha256,
    archiveBytes: bundle.archiveBytes,
    createdAt: bundle.createdAt,
  };
}

function objectKey(
  feature: string,
  bundleId: string,
  artifact: 'manifest' | 'archive',
): string {
  return `${feature}/releases/${bundleId}/${artifact === 'manifest' ? 'manifest.json' : 'release.zip'}`;
}

async function handleControlRequest(
  environment: ControlEnv,
  request: Request,
  operation: () => Promise<Response>,
): Promise<Response> {
  try {
    if (!(await isAuthorized(request, environment.CONTROL_TOKEN))) {
      return jsonResponse(401, {
        error: { code: 'unauthorized', message: 'Authentication is required.' },
      });
    }
    return await operation();
  } catch (error) {
    if (error instanceof ApiError) {
      return jsonResponse(error.status, {
        error: { code: error.code, message: error.message },
      });
    }
    return jsonResponse(500, {
      error: { code: 'internal-error', message: 'Request could not be completed.' },
    });
  }
}

async function isAuthorized(request: Request, token: string): Promise<boolean> {
  const supplied = request.headers.get('Authorization');
  if (!token || !supplied?.startsWith('Bearer ')) return false;
  const [expectedHash, suppliedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)),
    crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(supplied.slice('Bearer '.length)),
    ),
  ]);
  const expected = new Uint8Array(expectedHash);
  const actual = new Uint8Array(suppliedHash);
  let difference = expected.length ^ actual.length;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected[index] ^ (actual[index] ?? 0);
  }
  return difference === 0;
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
