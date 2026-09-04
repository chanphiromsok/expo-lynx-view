import assert from 'node:assert/strict';

import {
  completeUpload,
  getCurrentUser,
  getDeploymentOverview,
  getDeploymentScopes,
  handleLocalUpload,
  login,
  registerUpload,
  updateDeployment,
  type ControlEnv,
} from '../worker/control-api.ts';
import { hexToBase64, sha256Hex } from '../worker/protocol.ts';
import type { ReleaseMetadata } from '../worker/schema.ts';

type StoredBundle = {
  appId: string;
  id: string;
  featureId: string;
  version: string;
  runtimeVersion: string;
  archiveSha256: string;
  archiveBytes: number;
  createdAt: string;
};

type StoredDeployment = {
  appId: string;
  featureId: string;
  bundleId: string | null;
  enabled: number;
  force: number;
  revision: number;
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
  const bundleKey = (appId: string, id: string) => `${appId}/${id}`;
  const deploymentKey = (appId: string, featureId: string) => `${appId}/${featureId}`;
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
              if (sql.includes('FROM deployments')) return deployments.get(deploymentKey(String(values[0]), String(values[1]))) ?? null;
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
              if (query.includes('from "deployments"')) {
                if (query.includes('group by')) {
                  return [...deployments.values()].map((deployment) => [deployment.appId, deployment.featureId]);
                }
                const deployment = deployments.get(deploymentKey(String(values[0]), String(values[1])));
                return { results: deployment ? [deployment] : [] };
              }
              if (query.includes('from "bundles"')) {
                if (query.includes('group by')) {
                  return [...bundles.values()].map((bundle) => [bundle.appId, bundle.featureId]);
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
              if (query.includes('from "deployments"')) {
                if (query.includes('group by')) {
                  return [...deployments.values()].map((deployment) => [deployment.appId, deployment.featureId]);
                }
                const deployment = deployments.get(deploymentKey(String(values[0]), String(values[1])));
                return deployment ? [[
                  deployment.appId,
                  deployment.featureId,
                  deployment.bundleId,
                  deployment.enabled,
                  deployment.force,
                  deployment.revision,
                  deployment.updatedAt,
                ]] : [];
              }
              if (query.includes('from "bundles"')) {
                if (query.includes('group by')) {
                  return [...bundles.values()].map((bundle) => [bundle.appId, bundle.featureId]);
                }
                const rows = query.includes('"bundles"."id" = ?')
                  ? [bundles.get(bundleKey(String(values[0]), String(values[1])))].filter(Boolean) as StoredBundle[]
                  : [...bundles.values()].filter((bundle) => bundle.appId === String(values[0]) && bundle.featureId === String(values[1]));
                return rows.map((bundle) => [
                  bundle.appId,
                  bundle.id,
                  bundle.featureId,
                  bundle.version,
                  bundle.runtimeVersion,
                  bundle.archiveSha256,
                  bundle.archiveBytes,
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
              if (query.includes('insert into "bundles"')) {
                const appId = String(values[0]);
                const id = String(values[1]);
                if (bundles.has(bundleKey(appId, id))) return { meta: { changes: 0 } };
                bundles.set(bundleKey(appId, id), {
                  appId,
                  id,
                  featureId: String(values[2]),
                  version: String(values[3]),
                  runtimeVersion: String(values[4]),
                  archiveSha256: String(values[5]),
                  archiveBytes: Number(values[6]),
                  createdAt: String(values[7]),
                });
                return { meta: { changes: 1 } };
              }
              if (query.includes('insert into "deployments"')) {
                const appId = String(values[0]);
                const feature = String(values[1]);
                const key = deploymentKey(appId, feature);
                const current = deployments.get(key);
                const expectedRevision = Number(values.at(-1));
                if (current && current.revision !== expectedRevision) return { meta: { changes: 0 } };
                deployments.set(key, {
                  appId,
                  featureId: feature,
                  bundleId: values[2] === null ? null : String(values[2]),
                  enabled: Number(values[3]),
                  force: Number(values[4]),
                  revision: Number(values[5]),
                  updatedAt: String(values[6]),
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
  return { database, bundles, deployments, users };
}

const archive = new Uint8Array([80, 75, 3, 4, 1, 2, 3, 4]);
const release: ReleaseMetadata = {
  schemaVersion: 1,
  appId: 'shop',
  feature: 'delivery',
  releaseId: 'delivery-20260901T011848990Z-ac8c0e',
  version: '2026.09.01',
  runtimeVersion: 'expo-57',
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
    release.appId!,
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
  assert.deepEqual(await scopes.json(), [{ appId: 'shop', feature: 'delivery' }]);
}

{
  const response = await registerUpload(
    { ...environment, LOCAL_UPLOADS: undefined },
    new Request('https://delivery.example/api/uploads', { headers: apiKeyAuthorization }),
    { ...release, releaseId: 'delivery-unconfigured' },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    bundleId: 'delivery-unconfigured',
    complete: false,
    uploaded: false,
  });
}

{
  const promote = await updateDeployment(
    environment,
    new Request('http://127.0.0.1:8787/api/deploy/delivery', { headers: sessionAuthorization }),
    release.appId!,
    'delivery',
    { bundleId: release.releaseId, force: false },
  );
  assert.equal(promote.status, 200);
  assert.equal(storage.deployments.get('shop/delivery')?.revision, 1);
  assert.equal(storage.deployments.get('shop/delivery')?.enabled, 0);

  const enabled = await updateDeployment(
    environment,
    new Request('http://127.0.0.1:8787/api/deploy/delivery', { headers: sessionAuthorization }),
    release.appId!,
    'delivery',
    { enabled: true },
  );
  assert.equal(enabled.status, 200);
  assert.equal(storage.deployments.get('shop/delivery')?.revision, 2);
  assert.equal(storage.deployments.get('shop/delivery')?.enabled, 1);

  const noOp = await updateDeployment(
    environment,
    new Request('http://127.0.0.1:8787/api/deploy/delivery', { headers: sessionAuthorization }),
    release.appId!,
    'delivery',
    { bundleId: release.releaseId, force: false },
  );
  assert.equal(noOp.status, 200);
  assert.equal(storage.deployments.get('shop/delivery')?.revision, 2);

  const forced = await updateDeployment(
    environment,
    new Request('http://127.0.0.1:8787/api/deploy/delivery', { headers: sessionAuthorization }),
    release.appId!,
    'delivery',
    { bundleId: release.releaseId, force: true },
  );
  assert.equal(forced.status, 200);
  assert.equal(storage.deployments.get('shop/delivery')?.revision, 3);
  assert.equal(storage.deployments.get('shop/delivery')?.force, 1);

  const disabled = await updateDeployment(
    environment,
    new Request('http://127.0.0.1:8787/api/deploy/delivery', { headers: sessionAuthorization }),
    release.appId!,
    'delivery',
    { enabled: false },
  );
  assert.equal(disabled.status, 200);
  assert.equal(storage.deployments.get('shop/delivery')?.bundleId, release.releaseId);
  assert.equal(storage.deployments.get('shop/delivery')?.force, 0);
}

assert.equal(hexToBase64(release.archiveSha256).length, 44);
console.log('Cloudflare control API tests passed.');
