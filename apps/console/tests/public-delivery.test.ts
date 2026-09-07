import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';

import { parseDeploymentPayload } from '../../../packages/expo-lynx/src/ReleaseProtocol.ts';
import {
  handlePublicDeliveryRequest,
  type DeliveryEnv,
} from '../worker/public-delivery.ts';

const feature = 'delivery';
const releaseId = 'delivery-20260901T011848990Z-ac8c0e';
const archive = new Uint8Array([80, 75, 3, 4]);
const archiveSha256 = '2'.repeat(64);
const keys = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 65_537 });
const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();

function environment(options: { deployment?: boolean; bundle?: boolean; legacyAmbiguous?: boolean; legacyOnly?: boolean; signingKey?: string } = {}): DeliveryEnv {
  const includeDeployment = options.deployment ?? true;
  const includeBundle = options.bundle ?? true;
  return {
    DELIVERY_SIGNING_PRIVATE_KEY: options.signingKey ?? privateKey,
    DB: {
      prepare(sql: string) {
        const query = sql.toLowerCase();
        return {
          bind(...values: unknown[]) {
            return {
              async first() {
                if (sql.includes('FROM deployments')) {
                  return includeDeployment && values.includes('ios') && (values.includes(2) || values.includes('expo-57')) ? {
                    bundleId: releaseId,
                    enabled: 1,
                    force: 0,
                    revision: 7,
                    updatedAt: '2026-09-01T01:20:00.000Z',
                    version: '2026.09.01',
                    platform: 'ios', runtimeVersion: 'expo-57',
                    archiveSha256,
                    archiveBytes: archive.byteLength,
                  } : null;
                }
                return includeBundle ? { archiveSha256, archiveBytes: archive.byteLength } : null;
              },
              async raw() {
                if (query.includes('from "deployments"')) {
                  const row = [
                    'default',
                    feature,
                    'ios',
                    'expo-57',
                    releaseId,
                    1,
                    0,
                    7,
                    '2026-09-01T01:20:00.000Z',
                  ];
                  if (!includeDeployment || !values.includes('ios') || (!values.includes(2) && !values.includes('expo-57'))) return [];
                  return values.includes(2) && options.legacyAmbiguous ? [row, [...row.slice(0, 3), 'expo-58', ...row.slice(4)]] : [row];
                }
                return includeBundle ? [[
                  'default',
                  releaseId,
                  feature,
                  '2026.09.01',
                  'ios',
                  'expo-57',
                  archiveSha256,
                  archive.byteLength,
                  '2026-09-01T01:20:00.000Z',
                ]] : [];
              },
            };
          },
        };
      },
    } as D1Database,
    ARTIFACTS: {
      async get(key) {
        if (options.legacyOnly && key.startsWith('default/')) return null;
        return includeBundle ? { body: new Blob([archive]).stream(), size: archive.byteLength } : null;
      },
    } as R2Bucket,
  };
}

{
  const response = await handlePublicDeliveryRequest(
    environment(),
    new Request(`https://delivery.example/v1/deploy/${feature}`),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { runtimeVersion: string }).runtimeVersion, 'expo-57');
}

{
  const response = await handlePublicDeliveryRequest(
    environment(),
    new Request(`https://delivery.example/v1/deploy/${feature}`, {
      headers: { 'lynx-platform': 'android', 'lynx-runtime-version': 'expo-57' },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    schemaVersion: 1,
    type: 'lynx-deployment',
    feature,
    revision: 1,
    enabled: false,
    runtimeVersion: 'expo-57',
    issuedAt: '1970-01-01T00:00:00.000Z',
  });
}

{
  const response = await handlePublicDeliveryRequest(
    environment({ legacyAmbiguous: true }),
    new Request(`https://delivery.example/v1/deploy/${feature}`),
  );
  assert.equal(response.status, 409);
}

{
  const response = await handlePublicDeliveryRequest(
    environment({ legacyOnly: true }),
    new Request(`https://delivery.example/v1/bundles/${feature}/${releaseId}/release.zip`),
  );
  assert.equal(response.status, 200);
}

{
  const response = await handlePublicDeliveryRequest(
    environment(),
    new Request(`https://delivery.example/v1/shop/${feature}`, { headers: { 'lynx-runtime-version': 'expo-57' } }),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as { archiveUrl: string };
  assert.equal(body.archiveUrl, `/v1/shop/${feature}/ios/${releaseId}/release.zip`);
}

{
  const response = await handlePublicDeliveryRequest(
    environment(),
    new Request(`https://delivery.example/v1/deploy/${feature}`, { headers: { 'lynx-runtime-version': 'expo-57' } }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8');
  const eTag = response.headers.get('ETag');
  assert.match(eTag ?? '', /^"[a-f0-9]{64}"$/);
  const signature = response.headers.get('Lynx-Signature');
  assert.ok(signature);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const verifier = createVerify('RSA-SHA256');
  verifier.update(bytes);
  verifier.end();
  assert.equal(verifier.verify(publicKey, Buffer.from(signature, 'base64url')), true);
  const mutated = new Uint8Array(bytes);
  mutated[mutated.length - 2] ^= 1;
  const mutatedVerifier = createVerify('RSA-SHA256');
  mutatedVerifier.update(mutated);
  mutatedVerifier.end();
  assert.equal(mutatedVerifier.verify(publicKey, Buffer.from(signature, 'base64url')), false);
  const parsed = parseDeploymentPayload(new TextDecoder().decode(bytes), feature);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw parsed.error;
  assert.equal(parsed.value.enabled, true);
  if (parsed.value.enabled) {
    assert.equal(parsed.value.releaseId, releaseId);
    assert.equal(parsed.value.archiveUrl, `/v1/bundles/${feature}/${releaseId}/release.zip`);
  }

  const notModified = await handlePublicDeliveryRequest(
    environment(),
    new Request(`https://delivery.example/v1/deploy/${feature}`, {
      headers: { 'If-None-Match': eTag!, 'lynx-runtime-version': 'expo-57' },
    }),
  );
  assert.equal(notModified.status, 304);
  assert.equal(notModified.headers.get('Cache-Control'), 'no-store');
  assert.equal(notModified.headers.get('ETag'), eTag);
}

{
  const response = await handlePublicDeliveryRequest(
    environment({ deployment: false }),
    new Request(`https://delivery.example/v1/deploy/${feature}`, { headers: { 'lynx-runtime-version': 'expo-57' } }),
  );
  assert.equal(response.status, 200);
  const body = await response.json() as { enabled: boolean; revision: number };
  assert.deepEqual(body, {
    schemaVersion: 1,
    type: 'lynx-deployment',
    feature,
    revision: 1,
    enabled: false,
    runtimeVersion: 'expo-57',
    issuedAt: '1970-01-01T00:00:00.000Z',
  });
  assert.ok(response.headers.get('Lynx-Signature'));
}

{
  const response = await handlePublicDeliveryRequest(
    environment(),
    new Request(`https://delivery.example/v1/deploy/${feature}`, { headers: { 'lynx-runtime-version': 'expo-58' } }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    schemaVersion: 1,
    type: 'lynx-deployment',
    feature,
    revision: 1,
    enabled: false,
    runtimeVersion: 'expo-58',
    issuedAt: '1970-01-01T00:00:00.000Z',
  });
}

{
  const response = await handlePublicDeliveryRequest(
    environment({ signingKey: '' }),
    new Request(`https://delivery.example/v1/deploy/${feature}`, { headers: { 'lynx-runtime-version': 'expo-57' } }),
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: { code: 'signing-not-configured', message: 'Delivery signing is unavailable.' },
  });
}

{
  const response = await handlePublicDeliveryRequest(
    environment(),
    new Request(`https://delivery.example/v1/bundles/${feature}/${releaseId}/release.zip`),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/zip');
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
  assert.equal(response.headers.get('ETag'), `"${archiveSha256}"`);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), archive);
}

{
  const response = await handlePublicDeliveryRequest(
    environment(),
    new Request(`https://delivery.example/v1/bundles/${feature}/${releaseId}/manifest`),
  );
  assert.equal(response.status, 404);
}

{
  const response = await handlePublicDeliveryRequest(
    environment({ bundle: false }),
    new Request(`https://delivery.example/v1/bundles/${feature}/${releaseId}/release.zip`),
  );
  assert.equal(response.status, 404);
}

console.log('Cloudflare public delivery route tests passed.');
