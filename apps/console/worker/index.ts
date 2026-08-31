import { env } from 'cloudflare:workers';
import { Elysia, t } from 'elysia';
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker';

import {
  completeUpload,
  getDeploymentOverview,
  registerUpload,
  updateDeployment,
  type ControlEnv,
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
const envelopeBody = t.Object(
  { envelopeText: t.String({ minLength: 1, maxLength: 4 * 1024 * 1024 }) },
  { additionalProperties: false },
);
const updateBody = t.Union([
  t.Object({ enabled: t.Boolean() }, { additionalProperties: false }),
  t.Object(
    {
      bundleId: t.String({
        pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$',
      }),
      force: t.Boolean(),
    },
    { additionalProperties: false },
  ),
]);

const bindings = env as Env;

export const app = new Elysia({ adapter: CloudflareAdapter })
  .get('/health', ({ request }) =>
    handlePublicDeliveryRequest(bindings, request),
  )
  .get('/v1/deploy/:feature', ({ request }) =>
    handlePublicDeliveryRequest(bindings, request),
  )
  .get('/v1/bundles/:feature/:bundleId/manifest', ({ request }) =>
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
      updateDeployment(bindings, request, params.feature, body),
    { params: featureParameters, body: updateBody },
  )
  .post(
    '/api/uploads',
    ({ request, body }) => registerUpload(bindings, request, body.envelopeText),
    { body: envelopeBody },
  )
  .post(
    '/api/uploads/:bundleId/complete',
    ({ request, params, body }) =>
      completeUpload(bindings, request, params.bundleId, body.envelopeText),
    { params: bundleParameters, body: envelopeBody },
  )
  .all('*', ({ request }) => handlePublicDeliveryRequest(bindings, request))
  .compile();

export default app;
