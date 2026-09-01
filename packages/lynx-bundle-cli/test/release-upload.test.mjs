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
  schemaVersion: 1,
  feature: 'delivery',
  releaseId: 'delivery-20260901T011848990Z-ac8c0e',
  version: '2026.09.01',
  runtimeVersion: 'expo-57',
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

test('registers, sends the ZIP only to the upload URL, and completes the release', async () => {
  const directory = temporaryRelease();
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === 'https://delivery.example/api/uploads') {
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.Authorization, 'Bearer control-token');
      assert.deepEqual(JSON.parse(init.body), release);
      return response({
        bundleId: release.releaseId,
        complete: false,
        upload: {
          method: 'PUT',
          url: 'https://r2.example/release.zip?signature=redacted',
          headers: { 'content-type': 'application/zip', 'x-amz-checksum-sha256': 'checksum' },
        },
      });
    }
    if (url.startsWith('https://r2.example/release.zip')) {
      assert.equal(init.method, 'PUT');
      assert.deepEqual(init.headers, { 'content-type': 'application/zip', 'x-amz-checksum-sha256': 'checksum' });
      assert.deepEqual(Buffer.from(init.body), archive);
      assert.equal(init.redirect, 'error');
      assert.equal('Authorization' in init.headers, false);
      return new Response(null, { status: 200 });
    }
    if (url === `https://delivery.example/api/uploads/${release.releaseId}/complete`) {
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.Authorization, 'Bearer control-token');
      assert.deepEqual(JSON.parse(init.body), release);
      return response({ bundle: { id: release.releaseId, version: release.version, runtimeVersion: release.runtimeVersion, archiveSha256, archiveBytes: archive.byteLength }, created: true }, 201);
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await uploadRelease({
    releaseDirectory: directory,
    server: 'https://delivery.example/',
    token: 'control-token',
    fetchImpl,
  });

  assert.deepEqual(result, {
    bundle: { id: release.releaseId, version: release.version, runtimeVersion: release.runtimeVersion, archiveSha256, archiveBytes: archive.byteLength },
    created: true,
    alreadyComplete: false,
  });
  assert.deepEqual(calls.map(({ url }) => url), [
    'https://delivery.example/api/uploads',
    'https://r2.example/release.zip?signature=redacted',
    `https://delivery.example/api/uploads/${release.releaseId}/complete`,
  ]);
});

test('skips PUT and completion when the Worker already registered matching metadata', async () => {
  const directory = temporaryRelease();
  const calls = [];
  const result = await uploadRelease({
    releaseDirectory: directory,
    server: 'https://delivery.example',
    token: 'control-token',
    fetchImpl: async (input) => {
      calls.push(String(input));
      return response({ bundleId: release.releaseId, complete: true });
    },
  });
  assert.deepEqual(result, {
    bundle: { id: release.releaseId, version: release.version, runtimeVersion: release.runtimeVersion },
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
    token: 'control-token',
    fetchImpl: async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/api/uploads')) {
        return response({ bundleId: release.releaseId, complete: false, upload: { method: 'PUT', url: null, headers: {}, uploaded: true } });
      }
      return response({ bundle: { id: release.releaseId, version: release.version, runtimeVersion: release.runtimeVersion, archiveSha256, archiveBytes: archive.byteLength }, created: true }, 201);
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
      token: 'control-token',
      fetchImpl: async () => { called = true; return response({}); },
    }),
    /missing release\.json/,
  );
  assert.equal(called, false);

  writeFileSync(resolve(directory, 'release.json'), JSON.stringify({ ...release, archiveBytes: 99 }));
  await assert.rejects(
    uploadRelease({ releaseDirectory: directory, server: 'https://delivery.example', token: 'control-token' }),
    /byte length does not match/,
  );
});

test('reports a clear Worker endpoint when registration cannot connect', async () => {
  await assert.rejects(
    uploadRelease({
      releaseDirectory: temporaryRelease(),
      server: 'http://127.0.0.1:8787',
      token: 'control-token',
      fetchImpl: async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:8787'); },
    }),
    /Registration failed at http:\/\/127\.0\.0\.1:8787\/api\/uploads: the delivery Worker could not be reached/,
  );
});
