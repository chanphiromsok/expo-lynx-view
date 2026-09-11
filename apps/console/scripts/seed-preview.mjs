#!/usr/bin/env node

/**
 * Seeds the local delivery Worker with realistic preview data so the
 * Console's release-per-row UI has something to show without hand-building
 * and uploading real mini-app releases first.
 *
 * Local-only: it logs in with the fixed local admin/123456 account and the
 * fixed local API key that `pnpm lynx console` bootstraps. Never point this
 * at a deployed Worker — --server refuses anything but 127.0.0.1/localhost.
 *
 * Usage:
 *   pnpm lynx console            # in one terminal — starts the local Worker
 *   pnpm --filter @expo-lynx/delivery-console seed:local   # in another
 */

import { createHash } from 'node:crypto';

const server = normalizeServer(process.argv.find((arg) => arg.startsWith('--server='))?.split('=')[1] ?? 'http://127.0.0.1:8787');
const localApiKey = 'lynx_live_local_testing_only_1234567890';
const apiKeyHeader = { Authorization: `Bearer ${localApiKey}` };

const appId = 'default';
const feature = 'delivery';

// Real fingerprints from this monorepo's apps/expo-lynx-example (see
// `pnpm exec lynx host prepare --json` from that app) — using the actual
// values makes the preview line up with `pnpm lynx host prepare` output
// instead of showing an arbitrary fake runtime.
const iosRuntimeOld = 'ios:5ecf3ecd4bbbad464feda810ff470fe6e3df041f';
const iosRuntimeCurrent = 'ios:aebde9a27da8aa0400a2e6b802a5a28b8bb7dc38';
const androidRuntimeCurrent = 'android:0f90fc0b60c91245737e18db60e6fbc447f90f61';

const releases = [
  {
    releaseId: 'delivery-20260901T140322Z-77aa10',
    version: 'local-20260901T140322',
    git: { commit: '40c7d3595a3c4c4a0f4e0f3b6a8b6c1d2e3f4a5b', branch: 'fix/android-delivery-epoch', subject: 'fix(android): bump deliveryEpoch on user managed loads, cache asset listings', dirty: true },
  },
  {
    releaseId: 'delivery-20260908T091507Z-a1b2c3',
    version: 'local-20260908T091507',
    git: { commit: '9aced0a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8', branch: 'main', subject: 'fix(ios): delivery-stage fallback emits ERR_LYNX_DELIVERY, not a raw NSError code', dirty: false },
  },
  {
    releaseId: 'delivery-20260910T041233Z-9f2a1c',
    version: 'local-20260910T041233',
    git: { commit: '1855147abcdef0123456789abcdef0123456789a', branch: 'main', subject: 'test(android): extract load-arbitration counters into a unit-testable class', dirty: false },
  },
];

async function main() {
  await preflight();
  const cookie = await login();
  await ensureApp(cookie);
  await ensureMiniApp(cookie);

  console.log('\n--- host runtimes ---');
  // Register the *old* iOS runtime first, deploy a release to it, then
  // register the *current* one. host_runtimes keeps only the latest row per
  // platform, but the deployments table keeps the old (platform, runtime)
  // row around — exactly the "older runtime still in the wild" case.
  await registerRuntime('ios', iosRuntimeOld, '1.0.0', '2');
  await uploadRelease(releases[0]);
  await setDeployment(cookie, 'ios', iosRuntimeOld, { bundleId: releases[0].releaseId, force: false });
  await setDeployment(cookie, 'ios', iosRuntimeOld, { enabled: true });

  await registerRuntime('ios', iosRuntimeCurrent, '1.0.0', '3');
  await registerRuntime('android', androidRuntimeCurrent, '1.0.0', '3');

  console.log('\n--- releases ---');
  await uploadRelease(releases[1]);
  await uploadRelease(releases[2]);

  console.log('\n--- deployments ---');
  // iOS current runtime: Live on the newest release.
  await setDeployment(cookie, 'ios', iosRuntimeCurrent, { bundleId: releases[2].releaseId, force: false });
  await setDeployment(cookie, 'ios', iosRuntimeCurrent, { enabled: true });
  // Android current runtime: only Staged, on the middle release — this is
  // the cross-platform divergence the "replace live release" confirm and
  // the divergence note are for.
  await setDeployment(cookie, 'android', androidRuntimeCurrent, { bundleId: releases[1].releaseId, force: false });

  console.log(`\nSeeded ${server}. Open the Console and sign in with admin / 123456.`);
}

async function preflight() {
  let response;
  try {
    response = await fetch(`${server}/health`);
  } catch {
    throw new Error(`Could not reach ${server}. Start it first with: pnpm lynx console`);
  }
  if (!response.ok) throw new Error(`${server}/health returned HTTP ${response.status}. Is the local Worker healthy?`);
}

async function login() {
  const response = await fetch(`${server}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '123456' }),
  });
  if (!response.ok) {
    throw new Error(
      `Login failed with HTTP ${response.status}. This script only works against a fresh local Worker ` +
        '(pnpm lynx console bootstraps admin/123456 the first time the users table is empty). ' +
        'If you changed the local admin password, log in through the Console UI instead and skip this script.',
    );
  }
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Login succeeded but returned no session cookie.');
  console.log('Logged in as the local admin account.');
  return cookie;
}

async function ensureApp(cookie) {
  const response = await fetch(`${server}/api/apps`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ id: appId, name: 'Expo Lynx Example' }),
  });
  if (response.ok || response.status === 409) {
    console.log(response.ok ? `Created app "${appId}".` : `App "${appId}" already exists.`);
    return;
  }
  throw new Error(`Could not create app "${appId}": HTTP ${response.status} — ${await response.text()}`);
}

async function ensureMiniApp(cookie) {
  const response = await fetch(`${server}/api/apps/${appId}/mini-apps`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ id: feature, name: 'Delivery' }),
  });
  if (response.ok || response.status === 409) {
    console.log(response.ok ? `Created mini app "${feature}".` : `Mini app "${feature}" already exists.`);
    return;
  }
  throw new Error(`Could not create mini app "${feature}": HTTP ${response.status} — ${await response.text()}`);
}

async function registerRuntime(platform, runtimeVersion, appVersion, buildNumber) {
  const response = await fetch(`${server}/api/apps/${appId}/runtime`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...apiKeyHeader },
    body: JSON.stringify({ schemaVersion: 1, platform, runtimeVersion, appVersion, buildNumber, features: [feature] }),
  });
  if (!response.ok) throw new Error(`Could not register ${platform} runtime ${runtimeVersion}: HTTP ${response.status} — ${await response.text()}`);
  console.log(`Registered ${platform} runtime ${runtimeVersion} (host ${appVersion} build ${buildNumber}).`);
}

async function uploadRelease({ releaseId, version, git }) {
  // A trivial deterministic "archive": only its declared SHA-256/length need
  // to match for the local preview, since nothing here exercises the real
  // mobile download path.
  const archiveBytes = Buffer.from(`PKlynx-preview-seed:${releaseId}`, 'utf8');
  const archiveSha256 = createHash('sha256').update(archiveBytes).digest('hex');
  const release = { schemaVersion: 4, appId, feature, releaseId, version, archiveSha256, archiveBytes: archiveBytes.byteLength, git };

  const registered = await fetch(`${server}/api/uploads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...apiKeyHeader },
    body: JSON.stringify(release),
  });
  if (!registered.ok) throw new Error(`Could not register release ${releaseId}: HTTP ${registered.status} — ${await registered.text()}`);
  const registration = await registered.json();

  if (registration.complete !== true) {
    if (registration.uploaded !== true) {
      const upload = registration.upload;
      const put = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: archiveBytes, redirect: 'error' });
      if (!put.ok) throw new Error(`Local R2 upload failed for ${releaseId}: HTTP ${put.status} — ${await put.text()}`);
    }
    const completed = await fetch(`${server}/api/uploads/${encodeURIComponent(releaseId)}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...apiKeyHeader },
      body: JSON.stringify(release),
    });
    if (!completed.ok) throw new Error(`Could not complete release ${releaseId}: HTTP ${completed.status} — ${await completed.text()}`);
  }
  console.log(`Uploaded ${releaseId} (${version})${git.dirty ? ' [dirty]' : ''}.`);
}

async function setDeployment(cookie, platform, runtimeVersion, update) {
  const response = await fetch(
    `${server}/api/deploy/${appId}/${feature}?platform=${encodeURIComponent(platform)}&runtimeVersion=${encodeURIComponent(runtimeVersion)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(update),
    },
  );
  if (!response.ok) throw new Error(`Could not update ${platform}/${runtimeVersion} deployment: HTTP ${response.status} — ${await response.text()}`);
  const label = 'enabled' in update ? (update.enabled ? 'enabled' : 'disabled') : `selected ${update.bundleId}`;
  console.log(`Deployment ${platform}/${runtimeVersion}: ${label}.`);
}

function normalizeServer(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('--server must be an absolute http(s) URL.');
  }
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new Error('This script seeds fake preview data and only targets a local Worker (127.0.0.1/localhost).');
  }
  return url.toString().replace(/\/$/, '');
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
