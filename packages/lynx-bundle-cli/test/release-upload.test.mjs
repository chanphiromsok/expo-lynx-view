import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import { uploadRelease } from '../src/release-upload.mjs';

const archive = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const archiveSha256 = createHash('sha256').update(archive).digest('hex');
const release = {
  schemaVersion: 3,
  appId: 'bs-one',
  feature: 'delivery',
  releaseId: 'delivery-20260901T011848990Z-ac8c0e',
  version: '2026.09.01',
  archiveSha256,
  archiveBytes: archive.byteLength,
};

function temporaryRelease() {
  const directory = mkdtempSync(resolve(tmpdir(), 'lynx-release-upload-'));
  writeFileSync(resolve(directory, 'release.json'), `${JSON.stringify(release)}\n`);
  writeFileSync(resolve(directory, 'release.zip'), archive);
  return directory;
}

function response(value, status = 200) {
  return Response.json(value, { status });
}

test('registers, sends the ZIP directly to R2, and completes the release', async () => {
  const directory = temporaryRelease();
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === 'https://delivery.example/api/uploads') {
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.Authorization, 'Bearer lynx_live_test_key');
      assert.deepEqual(JSON.parse(init.body), release);
      return response({
        bundleId: release.releaseId,
        complete: false,
        uploaded: false,
      });
    }
    if (url === `https://delivery.example/api/uploads/${release.releaseId}/complete`) {
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.Authorization, 'Bearer lynx_live_test_key');
      assert.deepEqual(JSON.parse(init.body), release);
      return response({ bundle: { id: release.releaseId, version: release.version, archiveSha256, archiveBytes: archive.byteLength }, created: true }, 201);
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await uploadRelease({
    releaseDirectory: directory,
    server: 'https://delivery.example/',
    apiKey: 'lynx_live_test_key',
    fetchImpl,
    r2: { accountId: 'account', bucketName: 'bundles', accessKeyId: 'key', secretAccessKey: 'secret' },
    r2FetchImpl: async (input, init = {}) => {
      const url = String(input);
      calls.push({ url, init });
      assert.equal(url, `https://account.r2.cloudflarestorage.com/bundles/bs-one/delivery/releases/${release.releaseId}/release.zip`);
      assert.equal(init.method, 'PUT');
      assert.deepEqual(init.headers, {
        'content-type': 'application/zip',
        'if-none-match': '*',
        'x-amz-checksum-sha256': Buffer.from(archiveSha256, 'hex').toString('base64'),
      });
      assert.deepEqual(Buffer.from(init.body), archive);
      assert.equal(init.redirect, 'error');
      return new Response(null, { status: 200 });
    },
  });

  assert.deepEqual(result, {
    bundle: { id: release.releaseId, version: release.version, archiveSha256, archiveBytes: archive.byteLength },
    created: true,
    alreadyComplete: false,
  });
  assert.deepEqual(calls.map(({ url }) => url), [
    'https://delivery.example/api/uploads',
    `https://account.r2.cloudflarestorage.com/bundles/bs-one/delivery/releases/${release.releaseId}/release.zip`,
    `https://delivery.example/api/uploads/${release.releaseId}/complete`,
  ]);
});

test('skips PUT and completion when the Worker already registered matching metadata', async () => {
  const directory = temporaryRelease();
  const calls = [];
  const result = await uploadRelease({
    releaseDirectory: directory,
    server: 'https://delivery.example',
    apiKey: 'lynx_live_test_key',
    fetchImpl: async (input) => {
      calls.push(String(input));
      return response({ bundleId: release.releaseId, complete: true });
    },
  });
  assert.deepEqual(result, {
    bundle: { id: release.releaseId, version: release.version },
    created: false,
    alreadyComplete: true,
  });
  assert.deepEqual(calls, ['https://delivery.example/api/uploads']);
});

test('skips PUT when a prior interrupted run already uploaded the matching ZIP', async () => {
  const directory = temporaryRelease();
  const calls = [];
  const result = await uploadRelease({
    releaseDirectory: directory,
    server: 'https://delivery.example',
    apiKey: 'lynx_live_test_key',
    fetchImpl: async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/api/uploads')) {
        return response({ bundleId: release.releaseId, complete: false, uploaded: true });
      }
      return response({ bundle: { id: release.releaseId, version: release.version, archiveSha256, archiveBytes: archive.byteLength }, created: true }, 201);
    },
  });
  assert.equal(result.created, true);
  assert.deepEqual(calls, [
    'https://delivery.example/api/uploads',
    `https://delivery.example/api/uploads/${release.releaseId}/complete`,
  ]);
});

test('fails before network activity when release.json is missing or ZIP metadata differs', async () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'lynx-release-upload-missing-'));
  writeFileSync(resolve(directory, 'release.zip'), archive);
  let called = false;
  await assert.rejects(
    uploadRelease({
      releaseDirectory: directory,
      server: 'https://delivery.example',
      apiKey: 'lynx_live_test_key',
      fetchImpl: async () => { called = true; return response({}); },
    }),
    /missing release\.json/,
  );
  assert.equal(called, false);

  writeFileSync(resolve(directory, 'release.json'), JSON.stringify({ ...release, archiveBytes: 99 }));
  await assert.rejects(
    uploadRelease({ releaseDirectory: directory, server: 'https://delivery.example', apiKey: 'lynx_live_test_key' }),
    /byte length does not match/,
  );
});

test('reports a clear Worker endpoint when registration cannot connect', async () => {
  await assert.rejects(
    uploadRelease({
      releaseDirectory: temporaryRelease(),
      server: 'http://127.0.0.1:8787',
      apiKey: 'lynx_live_test_key',
      fetchImpl: async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:8787'); },
    }),
    /Registration failed at http:\/\/127\.0\.0\.1:8787\/api\/uploads: the delivery Worker could not be reached/,
  );
});

test('reports R2’s safe rejection code without exposing the R2 URL', async () => {
  await assert.rejects(
    uploadRelease({
      releaseDirectory: temporaryRelease(),
      server: 'https://delivery.example',
      apiKey: 'lynx_live_test_key',
      fetchImpl: async () => response({ bundleId: release.releaseId, complete: false, uploaded: false }),
      r2: { accountId: 'account', bucketName: 'bundles', accessKeyId: 'key', secretAccessKey: 'secret' },
      r2FetchImpl: async () => new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 }),
    }),
    /R2 upload failed with HTTP 403 — R2 AccessDenied\. Check that R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are an R2 S3 access key with Object Read & Write for the configured bucket\./,
  );
});
