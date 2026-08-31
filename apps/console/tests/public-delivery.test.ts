import assert from 'node:assert/strict';

import {
  handlePublicDeliveryRequest,
  type DeliveryEnv,
} from '../worker/public-delivery.ts';

const feature = 'delivery';
const bundle = 'delivery-20260830T143512-a1b2c3';
const manifest = new TextEncoder().encode('{"signed":true}\n');
const archive = new Uint8Array([1, 2, 3, 4]);
const manifestSha256 = '1'.repeat(64);
const archiveSha256 = '2'.repeat(64);
const deploymentSha256 = '3'.repeat(64);
const deploymentText = '{"schemaVersion":1,"payload":"signed"}\n';

function environment(options: { deployment?: boolean; bundle?: boolean } = {}): DeliveryEnv {
  const includeDeployment = options.deployment ?? true;
  const includeBundle = options.bundle ?? true;
  return {
    DB: {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async first() {
                if (sql.includes('FROM deployments')) {
                  return includeDeployment
                    ? {
                        envelopeText: deploymentText,
                        envelopeSha256: deploymentSha256,
                      }
                    : null;
                }
                return includeBundle
                  ? {
                      manifestSha256,
                      manifestBytes: manifest.byteLength,
                      archiveSha256,
                      archiveBytes: archive.byteLength,
                    }
                  : null;
              },
            };
          },
        };
      },
    } as D1Database,
    ARTIFACTS: {
      async get(key: string) {
        const bytes = key.endsWith('manifest.json') ? manifest : archive;
        return {
          body: new Blob([bytes]).stream(),
          size: bytes.byteLength,
        };
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
  assert.equal(response.headers.get('Cache-Control'), 'no-cache');
  assert.equal(response.headers.get('ETag'), `"${deploymentSha256}"`);
  assert.equal(await response.text(), deploymentText);
}

{
  const response = await handlePublicDeliveryRequest(
    environment(),
    new Request(`https://delivery.example/v1/deploy/${feature}`, {
      headers: { 'If-None-Match': `"${deploymentSha256}"` },
    }),
  );
  assert.equal(response.status, 304);
}

for (const [path, bytes, contentType, etag] of [
  ['manifest', manifest, 'application/json; charset=utf-8', manifestSha256],
  ['release.zip', archive, 'application/zip', archiveSha256],
] as const) {
  const response = await handlePublicDeliveryRequest(
    environment(),
    new Request(
      `https://delivery.example/v1/bundles/${feature}/${bundle}/${path}`,
    ),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), contentType);
  assert.equal(
    response.headers.get('Cache-Control'),
    'public, max-age=31536000, immutable',
  );
  assert.equal(response.headers.get('ETag'), `"${etag}"`);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
}

{
  const response = await handlePublicDeliveryRequest(
    environment({ deployment: false }),
    new Request(`https://delivery.example/v1/deploy/${feature}`),
  );
  assert.equal(response.status, 404);
}

{
  const response = await handlePublicDeliveryRequest(
    environment({ bundle: false }),
    new Request(
      `https://delivery.example/v1/bundles/${feature}/${bundle}/manifest`,
    ),
  );
  assert.equal(response.status, 404);
}

{
  const response = await handlePublicDeliveryRequest(
    environment(),
    new Request(
      'https://delivery.example/v1/bundles/delivery/%2E%2E%2Frelease/release.zip',
    ),
  );
  assert.equal(response.status, 404);
}

console.log('Cloudflare public delivery route tests passed.');
