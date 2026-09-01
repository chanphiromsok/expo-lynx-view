import assert from 'node:assert/strict';

import {
  completeUpload,
  getDeploymentOverview,
  handleLocalUpload,
  registerUpload,
  updateDeployment,
  type ControlEnv,
  type ReleaseMetadata,
} from '../worker/control-api.ts';
import { hexToBase64, sha256Hex } from '../worker/protocol.ts';

type StoredBundle = {
  id: string;
  featureId: string;
  version: string;
  runtimeVersion: string;
  archiveSha256: string;
  archiveBytes: number;
  createdAt: string;
};

type StoredDeployment = {
  featureId: string;
  bundleId: string | null;
  enabled: number;
  force: number;
  revision: number;
  updatedAt: string;
};

function createDatabase() {
  const bundles = new Map<string, StoredBundle>();
  const deployments = new Map<string, StoredDeployment>();
  const database = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first() {
              if (sql.includes('FROM deployments')) return deployments.get(String(values[0])) ?? null;
              if (sql.includes('FROM bundles')) {
                const bundle = bundles.get(String(values[1]));
                return bundle?.featureId === String(values[0]) ? bundle : null;
              }
              return null;
            },
            async all() {
              return { results: [...bundles.values()].filter((bundle) => bundle.featureId === String(values[0])) };
            },
            async run() {
              if (sql.includes('INSERT INTO bundles')) {
                const id = String(values[0]);
                if (bundles.has(id)) return { meta: { changes: 0 } };
                bundles.set(id, {
                  id,
                  featureId: String(values[1]),
                  version: String(values[2]),
                  runtimeVersion: String(values[3]),
                  archiveSha256: String(values[4]),
                  archiveBytes: Number(values[5]),
                  createdAt: String(values[6]),
                });
                return { meta: { changes: 1 } };
              }
              if (sql.includes('INSERT INTO deployments')) {
                const feature = String(values[0]);
                const current = deployments.get(feature);
                const expectedRevision = Number(values[6]);
                if (current && current.revision !== expectedRevision) return { meta: { changes: 0 } };
                deployments.set(feature, {
                  featureId: feature,
                  bundleId: values[1] === null ? null : String(values[1]),
                  enabled: Number(values[2]),
                  force: Number(values[3]),
                  revision: Number(values[4]),
                  updatedAt: String(values[5]),
                });
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  } as D1Database;
  return { database, bundles, deployments };
}

const archive = new Uint8Array([80, 75, 3, 4, 1, 2, 3, 4]);
const release: ReleaseMetadata = {
  schemaVersion: 1,
  feature: 'delivery',
  releaseId: 'delivery-20260901T011848990Z-ac8c0e',
  version: '2026.09.01',
  runtimeVersion: 'expo-57',
  archiveSha256: await sha256Hex(archive),
  archiveBytes: archive.byteLength,
};
const authorization = { Authorization: 'Bearer local-control-token' };
const storage = createDatabase();
const objects = new Map<string, Uint8Array>();
const environment: ControlEnv = {
  DB: storage.database,
  ARTIFACTS: {
    async head(key: string) {
      const bytes = objects.get(key);
      return bytes ? { size: bytes.byteLength, checksums: { sha256: undefined } } : null;
    },
    async get(key: string) {
      const bytes = objects.get(key);
      return bytes ? { body: new Blob([bytes]).stream(), size: bytes.byteLength } : null;
    },
    async put(key: string, value: ArrayBuffer | ArrayBufferView) {
      const bytes = value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      objects.set(key, new Uint8Array(bytes));
      return { key, size: bytes.byteLength } as R2Object;
    },
  } as R2Bucket,
  CONTROL_TOKEN: 'local-control-token',
  DELIVERY_SIGNING_PRIVATE_KEY: 'not used by control tests',
  LOCAL_UPLOADS: 'true',
};

{
  const response = await getDeploymentOverview(
    environment,
    new Request('http://127.0.0.1:8787/api/deploy/delivery'),
    'delivery',
  );
  assert.equal(response.status, 401);
}

const registered = await registerUpload(
  environment,
  new Request('http://127.0.0.1:8787/api/uploads', { headers: authorization }),
  release,
);
assert.equal(registered.status, 200);
const registration = await registered.json() as {
  complete: boolean;
  upload: { method: 'PUT'; url: string; headers: Record<string, string> };
};
assert.equal(registration.complete, false);
assert.equal(registration.upload.method, 'PUT');
assert.match(registration.upload.url, /^http:\/\/127\.0\.0\.1:8787\/__local-r2\//);

{
  const response = await handleLocalUpload(
    environment,
    new Request(registration.upload.url, {
      method: 'PUT',
      headers: registration.upload.headers,
      body: archive,
    }),
    release.feature,
    release.releaseId,
  );
  assert.equal(response.status, 200);
}

{
  const response = await completeUpload(
    environment,
    new Request(`http://127.0.0.1:8787/api/uploads/${release.releaseId}/complete`, { headers: authorization }),
    release.releaseId,
    release,
  );
  assert.equal(response.status, 201);
  assert.equal(storage.bundles.size, 1);
  const repeated = await completeUpload(
    environment,
    new Request(`http://127.0.0.1:8787/api/uploads/${release.releaseId}/complete`, { headers: authorization }),
    release.releaseId,
    release,
  );
  assert.equal(repeated.status, 200);
}

{
  const response = await registerUpload(
    { ...environment, LOCAL_UPLOADS: undefined },
    new Request('https://delivery.example/api/uploads', { headers: authorization }),
    { ...release, releaseId: 'delivery-unconfigured' },
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: { code: 'upload-not-configured', message: 'R2 upload is not configured.' },
  });
}

{
  const promote = await updateDeployment(
    environment,
    new Request('http://127.0.0.1:8787/api/deploy/delivery', { headers: authorization }),
    'delivery',
    { bundleId: release.releaseId, force: false },
  );
  assert.equal(promote.status, 200);
  assert.equal(storage.deployments.get('delivery')?.revision, 1);
  assert.equal(storage.deployments.get('delivery')?.enabled, 0);

  const enabled = await updateDeployment(
    environment,
    new Request('http://127.0.0.1:8787/api/deploy/delivery', { headers: authorization }),
    'delivery',
    { enabled: true },
  );
  assert.equal(enabled.status, 200);
  assert.equal(storage.deployments.get('delivery')?.revision, 2);
  assert.equal(storage.deployments.get('delivery')?.enabled, 1);

  const noOp = await updateDeployment(
    environment,
    new Request('http://127.0.0.1:8787/api/deploy/delivery', { headers: authorization }),
    'delivery',
    { bundleId: release.releaseId, force: false },
  );
  assert.equal(noOp.status, 200);
  assert.equal(storage.deployments.get('delivery')?.revision, 2);

  const forced = await updateDeployment(
    environment,
    new Request('http://127.0.0.1:8787/api/deploy/delivery', { headers: authorization }),
    'delivery',
    { bundleId: release.releaseId, force: true },
  );
  assert.equal(forced.status, 200);
  assert.equal(storage.deployments.get('delivery')?.revision, 3);
  assert.equal(storage.deployments.get('delivery')?.force, 1);

  const disabled = await updateDeployment(
    environment,
    new Request('http://127.0.0.1:8787/api/deploy/delivery', { headers: authorization }),
    'delivery',
    { enabled: false },
  );
  assert.equal(disabled.status, 200);
  assert.equal(storage.deployments.get('delivery')?.bundleId, release.releaseId);
  assert.equal(storage.deployments.get('delivery')?.force, 0);
}

assert.equal(hexToBase64(release.archiveSha256).length, 44);
console.log('Cloudflare control API tests passed.');
