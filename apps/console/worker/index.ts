import { env } from 'cloudflare:workers';
import { Elysia, t } from 'elysia';
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker';

import {
  completeUpload,
  getDeploymentOverview,
  handleLocalUpload,
  registerUpload,
  updateDeployment,
  type ControlEnv,
  type UpdateDeployment,
} from './control-api.ts';
import {
  handlePublicDeliveryRequest,
  type DeliveryEnv,
} from './public-delivery.ts';

export type Env = ControlEnv & DeliveryEnv;

const featureParameters = t.Object({
  feature: t.String({ pattern: '^[a-z][a-z0-9-]{0,63}$' }),
});
const bundleParameters = t.Object({
  bundleId: t.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' }),
});
const localUploadParameters = t.Object({
  feature: t.String({ pattern: '^[a-z][a-z0-9-]{0,63}$' }),
  bundleId: t.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' }),
});
const releaseBody = t.Object(
  {
    schemaVersion: t.Literal(1),
    feature: t.String({ pattern: '^[a-z][a-z0-9-]{0,63}$' }),
    releaseId: t.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' }),
    version: t.String({ minLength: 1, maxLength: 128 }),
    runtimeVersion: t.String({ minLength: 1, maxLength: 128 }),
    archiveSha256: t.String({ pattern: '^[a-f0-9]{64}$' }),
    archiveBytes: t.Integer({ minimum: 1, maximum: 64 * 1024 * 1024 }),
  },
  { additionalProperties: false },
);
// Controller validation distinguishes the two operations. Keeping this as a
// plain object also avoids TypeBox's Union compiler requirement in local Elysia.
const updateBody = t.Object({}, { additionalProperties: true });

const bindings = env as Env;

export const app = new Elysia({ adapter: CloudflareAdapter })
  .get('/health', ({ request }) =>
    handlePublicDeliveryRequest(bindings, request),
  )
  .get('/v1/deploy/:feature', ({ request }) =>
    handlePublicDeliveryRequest(bindings, request),
  )
  .get('/v1/bundles/:feature/:bundleId/release.zip', ({ request }) =>
    handlePublicDeliveryRequest(bindings, request),
  )
  .get(
    '/api/deploy/:feature',
    ({ request, params }) =>
      getDeploymentOverview(bindings, request, params.feature),
    { params: featureParameters },
  )
  .patch(
    '/api/deploy/:feature',
    ({ request, params, body }) =>
      updateDeployment(bindings, request, params.feature, body as UpdateDeployment),
    { params: featureParameters, body: updateBody },
  )
  .post(
    '/api/uploads',
    ({ request, body }) => registerUpload(bindings, request, body),
    { body: releaseBody },
  )
  .post(
    '/api/uploads/:bundleId/complete',
    ({ request, params, body }) =>
      completeUpload(bindings, request, params.bundleId, body),
    { params: bundleParameters, body: releaseBody },
  )
  .put(
    '/__local-r2/:feature/releases/:bundleId/release.zip',
    ({ request, params }) => handleLocalUpload(bindings, request, params.feature, params.bundleId),
    { params: localUploadParameters },
  )
  .all('*', ({ request }) => handlePublicDeliveryRequest(bindings, request))
  .compile();

export default app;
