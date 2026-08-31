import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  parseDeploymentPayload,
  parseSignedEnvelope,
  parseUnverifiedEnvelopePayload,
} from '../../../packages/expo-lynx/src/ReleaseProtocol.ts';
import {
  completeUpload,
  getDeploymentOverview,
  registerUpload,
  updateDeployment,
  type ControlEnv,
} from '../worker/control-api.ts';
import { sha256Hex } from '../worker/protocol.ts';

type StoredBundle = {
  id: string;
  featureId: string;
  version: string;
  manifestSha256: string;
  manifestBytes: number;
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
  envelopeText: string;
  envelopeSha256: string;
  updatedAt: string;
};

function hexBytes(value: string): Uint8Array {
  return Uint8Array.from(
    { length: value.length / 2 },
    (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

function createDatabase() {
  const bundles = new Map<string, StoredBundle>();
  const deployments = new Map<string, StoredDeployment>();
  const database = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first() {
              if (sql.includes('FROM deployments')) {
                return deployments.get(String(values[0])) ?? null;
              }
              if (sql.includes('FROM bundles')) {
                const feature = String(values[0]);
                const bundle = bundles.get(String(values[1]));
                return bundle?.featureId === feature ? bundle : null;
              }
              return null;
            },
            async all() {
              const feature = String(values[0]);
              return {
                results: [...bundles.values()].filter(
                  (bundle) => bundle.featureId === feature,
                ),
              };
            },
            async run() {
              if (sql.includes('INSERT INTO bundles')) {
                const id = String(values[0]);
                if (bundles.has(id)) return { meta: { changes: 0 } };
                bundles.set(id, {
                  id,
                  featureId: String(values[1]),
                  version: String(values[2]),
                  manifestSha256: String(values[3]),
                  manifestBytes: Number(values[4]),
                  archiveSha256: String(values[5]),
                  archiveBytes: Number(values[6]),
                  createdAt: String(values[7]),
                });
                return { meta: { changes: 1 } };
              }
              if (sql.includes('INSERT INTO deployments')) {
                const feature = String(values[0]);
                const expectedRevision = Number(values[8]);
                const current = deployments.get(feature);
                if (current && current.revision !== expectedRevision) {
                  return { meta: { changes: 0 } };
                }
                deployments.set(feature, {
                  featureId: feature,
                  bundleId: values[1] === null ? null : String(values[1]),
                  enabled: Number(values[2]),
                  force: Number(values[3]),
                  revision: Number(values[4]),
                  envelopeText: String(values[5]),
                  envelopeSha256: String(values[6]),
                  updatedAt: String(values[7]),
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

const fixtures = resolve(
  import.meta.dirname,
  '../../../packages/expo-lynx/feature/delivery-bundle-update/fixtures/v2',
);
const releaseEnvelopeText = readFileSync(
  resolve(fixtures, 'crypto-development/valid-release-envelope.json'),
  'utf8',
);
const releasePublicKey = readFileSync(
  resolve(fixtures, 'crypto-development/updates.public.pem'),
  'utf8',
);
const deploymentKeys = generateKeyPairSync('rsa', {
  modulusLength: 3072,
  publicExponent: 65_537,
});
const deploymentPrivateKey = deploymentKeys.privateKey.export({
  type: 'pkcs8',
  format: 'pem',
}).toString();
const authorization = { Authorization: 'Bearer test-control-token' };
const manifestSha256 = await sha256Hex(new TextEncoder().encode(releaseEnvelopeText));
const archiveSha256 = '2'.repeat(64);
const objects = new Map([
  [
    'shopping/releases/shopping-2026.08.29.1/manifest.json',
    { size: new TextEncoder().encode(releaseEnvelopeText).byteLength, sha256: manifestSha256 },
  ],
  [
    'shopping/releases/shopping-2026.08.29.1/release.zip',
    { size: 16, sha256: archiveSha256 },
  ],
]);
const storage = createDatabase();
const environment: ControlEnv = {
  DB: storage.database,
  ARTIFACTS: {
    async head(key: string) {
      const object = objects.get(key);
      if (!object) return null;
      return {
        size: object.size,
        checksums: { sha256: hexBytes(object.sha256).buffer },
      };
    },
  } as R2Bucket,
  CONTROL_TOKEN: 'test-control-token',
  RELEASE_PUBLIC_KEY: releasePublicKey,
  DEPLOYMENT_PRIVATE_KEY: deploymentPrivateKey,
  PUBLIC_BASE_URL: 'https://delivery.example',
  R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  R2_BUCKET_NAME: 'lynx-artifacts',
  R2_ACCESS_KEY_ID: 'test-access-key',
  R2_SECRET_ACCESS_KEY: 'test-secret-key',
};

{
  const response = await getDeploymentOverview(
    environment,
    new Request('https://delivery.example/api/deploy/shopping'),
    'shopping',
  );
  assert.equal(response.status, 401);
}

{
  const response = await registerUpload(
    environment,
    new Request('https://delivery.example/api/uploads', { headers: authorization }),
    releaseEnvelopeText,
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    uploads: { manifest: { uploaded: boolean }; archive: { uploaded: boolean } };
  };
  assert.equal(body.uploads.manifest.uploaded, true);
  assert.equal(body.uploads.archive.uploaded, true);
}

{
  const response = await completeUpload(
    environment,
    new Request('https://delivery.example/api/uploads/release/complete', {
      headers: authorization,
    }),
    'shopping-2026.08.29.1',
    releaseEnvelopeText,
  );
  assert.equal(response.status, 201);
  assert.equal(storage.bundles.size, 1);
  const repeated = await completeUpload(
    environment,
    new Request('https://delivery.example/api/uploads/release/complete', {
      headers: authorization,
    }),
    'shopping-2026.08.29.1',
    releaseEnvelopeText,
  );
  assert.equal(repeated.status, 200);
  assert.equal(storage.bundles.size, 1);
}

{
  const promote = await updateDeployment(
    environment,
    new Request('https://delivery.example/api/deploy/shopping', {
      headers: authorization,
    }),
    'shopping',
    { bundleId: 'shopping-2026.08.29.1', force: false },
  );
  assert.equal(promote.status, 200);
  assert.equal(storage.deployments.get('shopping')?.revision, 1);
  assert.equal(storage.deployments.get('shopping')?.enabled, 0);

  const enabled = await updateDeployment(
    environment,
    new Request('https://delivery.example/api/deploy/shopping', {
      headers: authorization,
    }),
    'shopping',
    { enabled: true },
  );
  assert.equal(enabled.status, 200);
  const stored = storage.deployments.get('shopping');
  assert.equal(stored?.revision, 2);
  assert.equal(stored?.enabled, 1);

  const envelope = parseSignedEnvelope(stored?.envelopeText);
  assert.equal(envelope.ok, true);
  if (!envelope.ok) throw envelope.error;
  const rawPayload = parseUnverifiedEnvelopePayload(envelope.value);
  assert.equal(rawPayload.ok, true);
  if (!rawPayload.ok) throw rawPayload.error;
  const payload = parseDeploymentPayload(rawPayload.value, 'shopping');
  assert.equal(payload.ok, true);
  if (!payload.ok) throw payload.error;
  assert.equal(payload.value.enabled, true);
  if (payload.value.enabled) {
    assert.equal(payload.value.releaseId, 'shopping-2026.08.29.1');
    assert.equal(payload.value.force, false);
  }

  const forced = await updateDeployment(
    environment,
    new Request('https://delivery.example/api/deploy/shopping', {
      headers: authorization,
    }),
    'shopping',
    { bundleId: 'shopping-2026.08.29.1', force: true },
  );
  assert.equal(forced.status, 200);
  assert.equal(storage.deployments.get('shopping')?.revision, 3);

  const disabled = await updateDeployment(
    environment,
    new Request('https://delivery.example/api/deploy/shopping', {
      headers: authorization,
    }),
    'shopping',
    { enabled: false },
  );
  assert.equal(disabled.status, 200);
  assert.equal(storage.deployments.get('shopping')?.bundleId, 'shopping-2026.08.29.1');
  assert.equal(storage.deployments.get('shopping')?.enabled, 0);
}

console.log('Cloudflare control API tests passed.');
