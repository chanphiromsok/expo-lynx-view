import assert from 'node:assert/strict';

import {
  completeUpload,
  createApp,
  createMiniApp,
  getCurrentUser,
  getDeploymentOverview,
  getDeploymentScopes,
  getMiniAppBundles,
  handleLocalUpload,
  login,
  logout,
  registerUpload,
  registerHostRuntime,
  updateDeployment,
  type ControlEnv,
} from '../worker/control-api.ts';
import { hexToBase64, sha256Hex } from '../worker/protocol.ts';
import type { MiniAppRelease } from '../worker/schema.ts';

type StoredBundle = {
  appId: string;
  id: string;
  featureId: string;
  version: string;
  archiveObjectKey: string;
  archiveSha256: string;
  archiveBytes: number;
  verifiedAt: string | null;
  createdAt: string;
};

type StoredApp = {
  id: string;
  name: string;
  currentRuntimeVersion: string | null;
  currentAppVersion: string | null;
  currentBuildNumber: string | null;
  createdAt: string;
};

type StoredMiniApp = {
  appId: string;
  id: string;
  name: string;
  createdAt: string;
};

type StoredDeployment = {
  appId: string;
  featureId: string;
  platform: string;
  runtimeVersion: string;
  bundleId: string | null;
  enabled: number;
  force: number;
  revision: number;
  updatedAt: string;
};

type StoredHostRuntime = {
  appId: string;
  platform: string;
  runtimeVersion: string;
  appVersion: string;
  buildNumber: string;
  updatedAt: string;
};

type StoredUser = {
  id: string;
  username: string;
  passwordHash: string;
  apiKeyHash: string;
  enabled: number;
  createdAt: string;
};

function createDatabase() {
  const bundles = new Map<string, StoredBundle>();
  const deployments = new Map<string, StoredDeployment>();
  const users = new Map<string, StoredUser>();
  const apps = new Map<string, StoredApp>();
  const miniApps = new Map<string, StoredMiniApp>();
  const hostRuntimes = new Map<string, StoredHostRuntime>();
  const bundleKey = (appId: string, id: string) => `${appId}/${id}`;
  const deploymentKey = (appId: string, featureId: string, platform: string, runtimeVersion: string) => `${appId}/${featureId}/${platform}/${runtimeVersion}`;
  const hostRuntimeKey = (appId: string, platform: string) => `${appId}/${platform}`;
  const miniAppKey = (appId: string, id: string) => `${appId}/${id}`;
  const database = {
    prepare(sql: string) {
      const query = sql.toLowerCase();
      return {
        bind(...values: unknown[]) {
          return {
            async first() {
              if (sql.includes('SELECT id FROM users LIMIT 1')) return [...users.values()][0] ?? null;
              if (sql.includes('FROM users WHERE username')) return [...users.values()].find((user) => user.username === String(values[0])) ?? null;
              if (sql.includes('FROM users WHERE api_key_hash')) return [...users.values()].find((user) => user.apiKeyHash === String(values[0])) ?? null;
              if (sql.includes('FROM users WHERE id')) return users.get(String(values[0])) ?? null;
              if (sql.includes('FROM deployments')) return deployments.get(deploymentKey(String(values[0]), String(values[1]), String(values[2]), String(values[3]))) ?? null;
              if (sql.includes('FROM host_runtimes')) return hostRuntimes.get(hostRuntimeKey(String(values[0]), String(values[1]))) ?? null;
              if (sql.includes('FROM apps')) return apps.get(String(values[0])) ?? null;
              if (sql.includes('FROM mini_apps')) return miniApps.get(miniAppKey(String(values[0]), String(values[1]))) ?? null;
              if (sql.includes('FROM bundles')) {
                return bundles.get(bundleKey(String(values[0]), String(values[1]))) ?? null;
              }
              return null;
            },
            async all() {
              if (query.includes('from "users"')) {
                if (query.includes('where "users"."username"')) {
                  return { results: [...users.values()].filter((user) => user.username === String(values[0])) };
                }
                if (query.includes('where "users"."api_key_hash"')) {
                  return { results: [...users.values()].filter((user) => user.apiKeyHash === String(values[0])) };
                }
                if (query.includes('where "users"."id"')) {
                  const user = users.get(String(values[0]));
                  return { results: user ? [user] : [] };
                }
                return { results: [...users.values()].slice(0, 1) };
              }
              if (query.includes('from "apps"')) {
                const app = apps.get(String(values[0]));
                return { results: app ? [app] : [] };
              }
              if (query.includes('from "mini_apps"')) {
                if (query.includes('"mini_apps"."id" = ?')) {
                  const miniApp = miniApps.get(miniAppKey(String(values[0]), String(values[1])));
                  return { results: miniApp ? [miniApp] : [] };
                }
                return { results: [...miniApps.values()].filter((miniApp) => miniApp.appId === String(values[0])) };
              }
              if (query.includes('from "deployments"')) {
                if (query.includes('group by')) {
                  return [...deployments.values()].map((deployment) => [deployment.appId, deployment.featureId, deployment.platform, deployment.runtimeVersion]);
                }
                const deployment = deployments.get(deploymentKey(String(values[0]), String(values[1]), String(values[2]), String(values[3])));
                return { results: deployment ? [deployment] : [] };
              }
              if (query.includes('from "host_runtimes"')) {
                const runtime = hostRuntimes.get(hostRuntimeKey(String(values[0]), String(values[1])));
                return { results: runtime ? [runtime] : [] };
              }
              if (query.includes('from "bundles"')) {
                if (query.includes('group by')) {
                  return [];
                }
                if (query.includes('"bundles"."id" = ?')) {
                  const bundle = bundles.get(bundleKey(String(values[0]), String(values[1])));
                  return { results: bundle ? [bundle] : [] };
                }
                return { results: [...bundles.values()].filter((bundle) => bundle.appId === String(values[0]) && bundle.featureId === String(values[1])) };
              }
              return { results: [] };
            },
            async raw() {
              if (query.includes('from "users"')) {
                const rows = query.includes('where "users"."username"')
                  ? [...users.values()].filter((user) => user.username === String(values[0]))
                  : query.includes('where "users"."api_key_hash"')
                    ? [...users.values()].filter((user) => user.apiKeyHash === String(values[0]))
                    : query.includes('where "users"."id"')
                      ? [users.get(String(values[0]))].filter(Boolean) as StoredUser[]
                      : [...users.values()].slice(0, 1);
                return rows.map((user) => query.includes('select "id" from')
                  ? [user.id]
                  : query.includes('"password_hash"')
                    ? [user.id, user.username, user.passwordHash, user.apiKeyHash, user.enabled, user.createdAt]
                    : [user.id, user.username, user.enabled]);
              }
              if (query.includes('from "apps"')) {
                const app = apps.get(String(values[0]));
                return app ? [[app.id, app.name, app.currentRuntimeVersion, app.currentAppVersion, app.currentBuildNumber, app.createdAt]] : [];
              }
              if (query.includes('from "mini_apps"')) {
                const rows = query.includes('"mini_apps"."id" = ?')
                  ? [miniApps.get(miniAppKey(String(values[0]), String(values[1])))].filter(Boolean) as StoredMiniApp[]
                  : [...miniApps.values()].filter((miniApp) => miniApp.appId === String(values[0]));
                return rows.map((miniApp) => (query.includes('select "mini_apps"."id"') || query.includes('select "id"'))
                  ? [miniApp.id]
                  : [miniApp.appId, miniApp.id, miniApp.name, miniApp.createdAt]);
              }
              if (query.includes('from "host_runtimes"')) {
                const runtime = hostRuntimes.get(hostRuntimeKey(String(values[0]), String(values[1])));
                return runtime ? [[runtime.appId, runtime.platform, runtime.runtimeVersion, runtime.appVersion, runtime.buildNumber, runtime.updatedAt]] : [];
              }
              if (query.includes('from "deployments"')) {
                if (query.includes('group by')) {
                  return [...deployments.values()].map((deployment) => [deployment.appId, deployment.featureId, deployment.platform, deployment.runtimeVersion]);
                }
                const deployment = deployments.get(deploymentKey(String(values[0]), String(values[1]), String(values[2]), String(values[3])));
                return deployment ? [[
                  deployment.appId,
                  deployment.featureId,
                  deployment.platform,
                  deployment.runtimeVersion,
                  deployment.bundleId,
                  deployment.enabled,
                  deployment.force,
                  deployment.revision,
                  deployment.updatedAt,
                ]] : [];
              }
              if (query.includes('from "bundles"')) {
                if (query.includes('group by')) {
                  return [];
                }
                const rows = query.includes('"bundles"."id" = ?')
                  ? [bundles.get(bundleKey(String(values[0]), String(values[1])))].filter(Boolean) as StoredBundle[]
                  : [...bundles.values()].filter((bundle) => bundle.appId === String(values[0]) && bundle.featureId === String(values[1]));
                return rows.map((bundle) => [
                  bundle.appId,
                  bundle.id,
                  bundle.featureId,
                  bundle.version,
                  bundle.archiveObjectKey,
                  bundle.archiveSha256,
                  bundle.archiveBytes,
                  bundle.verifiedAt,
                  bundle.createdAt,
                ]);
              }
              return [];
            },
            async run() {
              if (query.includes('insert into "users"')) {
                const id = String(values[0]);
                if (users.has(id) || [...users.values()].some((user) => user.username === String(values[1]))) return { meta: { changes: 0 } };
                users.set(id, {
                  id,
                  username: String(values[1]),
                  passwordHash: String(values[2]),
                  apiKeyHash: String(values[3]),
                  enabled: 1,
                  createdAt: String(values[4]),
                });
                return { meta: { changes: 1 } };
              }
              if (query.includes('insert into "apps"')) {
                const id = String(values[0]);
                if (apps.has(id)) return { meta: { changes: 0 } };
                apps.set(id, {
                  id,
                  name: String(values[1]),
                  currentRuntimeVersion: null,
                  currentAppVersion: null,
                  currentBuildNumber: null,
                  createdAt: String(values[2]),
                });
                return { meta: { changes: 1 } };
              }
              if (query.includes('insert into "mini_apps"')) {
                const appId = String(values[0]);
                const id = String(values[1]);
                if (miniApps.has(miniAppKey(appId, id))) return { meta: { changes: 0 } };
                miniApps.set(miniAppKey(appId, id), { appId, id, name: String(values[2]), createdAt: String(values[3]) });
                return { meta: { changes: 1 } };
              }
              if (query.includes('insert into "bundles"')) {
                const appId = String(values[0]);
                const id = String(values[1]);
                if (bundles.has(bundleKey(appId, id))) return { meta: { changes: 0 } };
                bundles.set(bundleKey(appId, id), {
                  appId,
                  id,
                  featureId: String(values[2]),
                  version: String(values[3]),
                  archiveObjectKey: String(values[4]),
                  archiveSha256: String(values[5]),
                  archiveBytes: Number(values[6]),
                  verifiedAt: values[7] === null ? null : String(values[7]),
                  createdAt: String(values[8]),
                });
                return { meta: { changes: 1 } };
              }
              if (query.includes('update "bundles"')) {
                const verifiedAt = String(values[0]);
                const appId = String(values[1]);
                const id = String(values[2]);
                const bundle = bundles.get(bundleKey(appId, id));
                if (!bundle || bundle.verifiedAt !== null) return { meta: { changes: 0 } };
                bundle.verifiedAt = verifiedAt;
                return { meta: { changes: 1 } };
              }
              if (query.includes('update apps set current_runtime_version')) {
                const app = apps.get(String(values[3]));
                if (!app) return { meta: { changes: 0 } };
                app.currentRuntimeVersion = String(values[0]);
                app.currentAppVersion = String(values[1]);
                app.currentBuildNumber = String(values[2]);
                return { meta: { changes: 1 } };
              }
              if (query.includes('insert or ignore into deployments')) {
                const appId = String(values[0]);
                const featureId = String(values[1]);
                const platform = String(values[2]);
                const runtimeVersion = String(values[3]);
                const key = deploymentKey(appId, featureId, platform, runtimeVersion);
                if (deployments.has(key)) return { meta: { changes: 0 } };
                deployments.set(key, { appId, featureId, platform, runtimeVersion, bundleId: null, enabled: 0, force: 0, revision: 2, updatedAt: String(values[4]) });
                return { meta: { changes: 1 } };
              }
              if (query.includes('insert into host_runtimes')) {
                const [appId, platform, runtimeVersion, appVersion, buildNumber, updatedAt] = values.map(String);
                hostRuntimes.set(hostRuntimeKey(appId, platform), { appId, platform, runtimeVersion, appVersion, buildNumber, updatedAt });
                return { meta: { changes: 1 } };
              }
              if (query.includes('insert into "deployments"')) {
                const appId = String(values[0]);
                const feature = String(values[1]);
                const platform = String(values[2]);
                const runtimeVersion = String(values[3]);
                const key = deploymentKey(appId, feature, platform, runtimeVersion);
                const current = deployments.get(key);
                const expectedRevision = Number(values.at(-1));
                if (current && current.revision !== expectedRevision) return { meta: { changes: 0 } };
                deployments.set(key, {
                  appId,
                  featureId: feature,
                  platform,
                  runtimeVersion,
                  bundleId: values[4] === null ? null : String(values[4]),
                  enabled: Number(values[5]),
                  force: Number(values[6]),
                  revision: Number(values[7]),
                  updatedAt: String(values[8]),
                });
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  } as D1Database;
  return { database, bundles, deployments, users, apps, miniApps, hostRuntimes };
}

const archive = new Uint8Array([80, 75, 3, 4, 1, 2, 3, 4]);
const release: MiniAppRelease = {
  schemaVersion: 3,
  appId: 'shop',
  feature: 'delivery',
  releaseId: 'delivery-20260901T011848990Z-ac8c0e',
  version: '2026.09.01',
  archiveSha256: await sha256Hex(archive),
  archiveBytes: archive.byteLength,
};
const apiKeyAuthorization = { Authorization: 'Bearer lynx_live_local_test_api_key_123456' };
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
  AUTH_SESSION_SECRET: 'local-auth-session-secret-with-enough-entropy',
  INITIAL_ADMIN_USERNAME: 'phirom',
  INITIAL_ADMIN_PASSWORD: 'local-console-password',
  INITIAL_ADMIN_API_KEY: 'lynx_live_local_test_api_key_123456',
  DELIVERY_SIGNING_PRIVATE_KEY: 'not used by control tests',
  LOCAL_UPLOADS: 'true',
};

{
  const localStorage = createDatabase();
  const response = await login(
    { ...environment, DB: localStorage.database, LOCAL_CONSOLE_DEFAULTS: 'true' },
    new Request('http://127.0.0.1:8787/api/auth/login', { method: 'POST' }),
    { username: 'admin', password: '123456' },
  );
  assert.equal(response.status, 200);
}

{
  const response = await getDeploymentOverview(
    environment,
    new Request('http://127.0.0.1:8787/api/deploy/delivery'),
    'delivery',
  );
  assert.equal(response.status, 401);
}

const loggedIn = await login(
  environment,
  new Request('http://127.0.0.1:8787/api/auth/login', { method: 'POST' }),
  { username: 'phirom', password: 'local-console-password' },
);
assert.equal(loggedIn.status, 200);
const sessionCookie = loggedIn.headers.get('Set-Cookie')?.split(';')[0];
assert.ok(sessionCookie);
const sessionAuthorization = { Cookie: sessionCookie };
{
  const response = await logout(
    environment,
    new Request('http://127.0.0.1:8787/api/auth/logout', { method: 'POST' }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.match(response.headers.get('Set-Cookie') ?? '', /Max-Age=0/);
}
{
  const response = await getCurrentUser(
    environment,
    new Request('http://127.0.0.1:8787/api/auth/me', { headers: sessionAuthorization }),
  );
  assert.equal(response.status, 200);
}

{
  const response = await getDeploymentScopes(
    environment,
    new Request('http://127.0.0.1:8787/api/deployments', { headers: sessionAuthorization }),
  );
  assert.deepEqual(await response.json(), []);
}

assert.equal((await createApp(
  environment,
  new Request('http://127.0.0.1:8787/api/apps', { headers: sessionAuthorization }),
  { id: 'shop', name: 'Shop' },
)).status, 201);
assert.equal((await createMiniApp(
  environment,
  new Request('http://127.0.0.1:8787/api/apps/shop/mini-apps', { headers: sessionAuthorization }),
  'shop',
  { id: 'delivery', name: 'Delivery' },
)).status, 201);
for (const platform of ['ios', 'android'] as const) {
  assert.equal((await registerHostRuntime(
    environment,
    new Request('http://127.0.0.1:8787/api/apps/shop/runtime', { headers: apiKeyAuthorization }),
    'shop',
    { schemaVersion: 1, platform, runtimeVersion: `${platform}-runtime`, appVersion: '1.0.0', buildNumber: '1', features: ['delivery'] },
  )).status, 200);
}

const registered = await registerUpload(
  environment,
  new Request('http://127.0.0.1:8787/api/uploads', { headers: apiKeyAuthorization }),
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
    release.appId,
    release.feature,
    release.releaseId,
  );
  assert.equal(response.status, 200);
}

{
  const response = await completeUpload(
    environment,
    new Request(`http://127.0.0.1:8787/api/uploads/${release.releaseId}/complete`, { headers: apiKeyAuthorization }),
    release.releaseId,
    release,
  );
  assert.equal(response.status, 201);
  assert.equal(storage.bundles.size, 1);
  const repeated = await completeUpload(
    environment,
    new Request(`http://127.0.0.1:8787/api/uploads/${release.releaseId}/complete`, { headers: apiKeyAuthorization }),
    release.releaseId,
    release,
  );
  assert.equal(repeated.status, 200);
  const scopes = await getDeploymentScopes(
    environment,
    new Request('http://127.0.0.1:8787/api/deployments', { headers: sessionAuthorization }),
  );
  assert.deepEqual(await scopes.json(), [
    { appId: 'shop', feature: 'delivery', platform: 'android', runtimeVersion: 'android-runtime' },
    { appId: 'shop', feature: 'delivery', platform: 'ios', runtimeVersion: 'ios-runtime' },
  ]);
  const uploadedBundles = await getMiniAppBundles(
    environment,
    new Request('http://127.0.0.1:8787/api/apps/shop/mini-apps/delivery/bundles', { headers: sessionAuthorization }),
    'shop',
    'delivery',
  );
  assert.equal(uploadedBundles.status, 200);
  assert.equal((await uploadedBundles.json() as Array<{ id: string }>)[0]?.id, release.releaseId);
}

{
  const response = await registerUpload(
    { ...environment, LOCAL_UPLOADS: undefined },
    new Request('https://delivery.example/api/uploads', { headers: apiKeyAuthorization }),
    { ...release, releaseId: 'delivery-unconfigured' },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    schemaVersion: 3,
    bundleId: 'delivery-unconfigured',
    complete: false,
    uploaded: false,
  });
}

{
  const promote = await updateDeployment(
    environment,
    new Request('http://127.0.0.1:8787/api/deploy/delivery?runtimeVersion=ios-runtime', { headers: sessionAuthorization }),
    release.appId,
    'delivery',
    { bundleId: release.releaseId, force: false },
  );
  assert.equal(promote.status, 200);
  assert.equal(storage.deployments.get('shop/delivery/ios/ios-runtime')?.revision, 3);
  assert.equal(storage.deployments.get('shop/delivery/ios/ios-runtime')?.enabled, 0);

  const enabled = await updateDeployment(
    environment,
    new Request('http://127.0.0.1:8787/api/deploy/delivery?runtimeVersion=ios-runtime', { headers: sessionAuthorization }),
    release.appId,
    'delivery',
    { enabled: true },
  );
  assert.equal(enabled.status, 200);
  assert.equal(storage.deployments.get('shop/delivery/ios/ios-runtime')?.revision, 4);
  assert.equal(storage.deployments.get('shop/delivery/ios/ios-runtime')?.enabled, 1);

  const noOp = await updateDeployment(
    environment,
    new Request('http://127.0.0.1:8787/api/deploy/delivery?runtimeVersion=ios-runtime', { headers: sessionAuthorization }),
    release.appId,
    'delivery',
    { bundleId: release.releaseId, force: false },
  );
  assert.equal(noOp.status, 200);
  assert.equal(storage.deployments.get('shop/delivery/ios/ios-runtime')?.revision, 4);

  const forced = await updateDeployment(
    environment,
    new Request('http://127.0.0.1:8787/api/deploy/delivery?runtimeVersion=ios-runtime', { headers: sessionAuthorization }),
    release.appId,
    'delivery',
    { bundleId: release.releaseId, force: true },
  );
  assert.equal(forced.status, 200);
  assert.equal(storage.deployments.get('shop/delivery/ios/ios-runtime')?.revision, 5);
  assert.equal(storage.deployments.get('shop/delivery/ios/ios-runtime')?.force, 1);

  const disabled = await updateDeployment(
    environment,
    new Request('http://127.0.0.1:8787/api/deploy/delivery?runtimeVersion=ios-runtime', { headers: sessionAuthorization }),
    release.appId,
    'delivery',
    { enabled: false },
  );
  assert.equal(disabled.status, 200);
  assert.equal(storage.deployments.get('shop/delivery/ios/ios-runtime')?.bundleId, release.releaseId);
  assert.equal(storage.deployments.get('shop/delivery/ios/ios-runtime')?.force, 0);
}

assert.equal((await updateDeployment(
  environment,
  new Request('http://127.0.0.1:8787/api/deploy/delivery?platform=android&runtimeVersion=android-runtime', { headers: sessionAuthorization }),
  release.appId,
  release.feature,
  { bundleId: release.releaseId, force: false },
)).status, 200);
assert.equal(storage.deployments.get('shop/delivery/ios/ios-runtime')?.bundleId, release.releaseId);
assert.equal(storage.deployments.get('shop/delivery/android/android-runtime')?.bundleId, release.releaseId);

{
  const createdApp = await createApp(
    environment,
    new Request('http://127.0.0.1:8787/api/apps', { headers: sessionAuthorization }),
    { id: 'bs-one', name: 'BS One' },
  );
  assert.equal(createdApp.status, 201);
  const createdMiniApp = await createMiniApp(
    environment,
    new Request('http://127.0.0.1:8787/api/apps/bs-one/mini-apps', { headers: sessionAuthorization }),
    'bs-one',
    { id: 'merchant-home', name: 'Merchant Home' },
  );
  assert.equal(createdMiniApp.status, 201);
  const runtimeA = await registerHostRuntime(
    environment,
    new Request('http://127.0.0.1:8787/api/apps/bs-one/runtime', { headers: apiKeyAuthorization }),
    'bs-one',
    { schemaVersion: 1, platform: 'ios', runtimeVersion: 'runtime-a', appVersion: '1.2.0', buildNumber: '42', features: ['merchant-home'] },
  );
  assert.equal(runtimeA.status, 200);
  assert.equal(storage.deployments.get('bs-one/merchant-home/ios/runtime-a')?.revision, 2);

  const independentRelease: MiniAppRelease = {
    schemaVersion: 3,
    appId: 'bs-one',
    feature: 'merchant-home',
    releaseId: 'merchant-home-20260905T120000Z-a1b2c3',
    version: '2026.09.05',
    archiveSha256: release.archiveSha256,
    archiveBytes: release.archiveBytes,
  };
  const reserved = await registerUpload(
    { ...environment, LOCAL_UPLOADS: undefined },
    new Request('https://delivery.example/api/uploads', { headers: apiKeyAuthorization }),
    independentRelease,
  );
  assert.equal(reserved.status, 200);
  assert.deepEqual(await reserved.json(), {
    schemaVersion: 3,
    bundleId: independentRelease.releaseId,
    complete: false,
    uploaded: false,
  });
  assert.equal(storage.bundles.get('bs-one/merchant-home-20260905T120000Z-a1b2c3')?.archiveObjectKey, 'bs-one/merchant-home/releases/merchant-home-20260905T120000Z-a1b2c3/release.zip');

  const runtimeB = await registerHostRuntime(
    environment,
    new Request('http://127.0.0.1:8787/api/apps/bs-one/runtime', { headers: apiKeyAuthorization }),
    'bs-one',
    { schemaVersion: 1, platform: 'ios', runtimeVersion: 'runtime-b', appVersion: '1.3.0', buildNumber: '43', features: ['merchant-home'] },
  );
  assert.equal(runtimeB.status, 200);
  const retried = await registerUpload(
    { ...environment, LOCAL_UPLOADS: undefined },
    new Request('https://delivery.example/api/uploads', { headers: apiKeyAuthorization }),
    independentRelease,
  );
  assert.equal(retried.status, 200);
  assert.equal(storage.bundles.get('bs-one/merchant-home-20260905T120000Z-a1b2c3')?.archiveObjectKey, 'bs-one/merchant-home/releases/merchant-home-20260905T120000Z-a1b2c3/release.zip');
  const rejectedUnknownMiniApp = await registerUpload(
    environment,
    new Request('http://127.0.0.1:8787/api/uploads', { headers: apiKeyAuthorization }),
    { ...independentRelease, feature: 'typo' },
  );
  assert.equal(rejectedUnknownMiniApp.status, 404);
}

assert.equal(hexToBase64(release.archiveSha256).length, 44);
console.log('Cloudflare control API tests passed.');
