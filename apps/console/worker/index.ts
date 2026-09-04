import { env } from 'cloudflare:workers';
import { Elysia } from 'elysia';
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker';

import {
  completeUpload,
  getCurrentUser,
  getDeploymentOverview,
  getDeploymentScopes,
  handleLocalUpload,
  login,
  logout,
  registerUpload,
  updateDeployment,
  type ControlEnv,
} from './control-api.ts';
import {
  handlePublicDeliveryRequest,
  type DeliveryEnv,
} from './public-delivery.ts';
import {
  BundleParametersSchema,
  AppFeatureParametersSchema,
  AppLocalUploadParametersSchema,
  DeploymentUpdateSchema,
  LoginSchema,
  ReleaseMetadataSchema,
  type DeploymentUpdateInput,
  type LoginInput,
  type ReleaseMetadata,
} from './schema.ts';

export type Env = ControlEnv & DeliveryEnv;

const bindings = env as Env;

export const app = new Elysia({ adapter: CloudflareAdapter })
  .get('/health', ({ request }) =>
    handlePublicDeliveryRequest(bindings, request),
  )
  .post('/api/auth/login', ({ request, body }) => login(bindings, request, body as LoginInput), { body: LoginSchema })
  .post('/api/auth/logout', ({ request }) => logout(bindings, request))
  .get('/api/auth/me', ({ request }) => getCurrentUser(bindings, request))
  .get('/api/deployments', ({ request }) => getDeploymentScopes(bindings, request))
  .get(
    '/api/deploy/:appId/:feature',
    ({ request, params }) =>
      getDeploymentOverview(bindings, request, params.appId, params.feature),
    { params: AppFeatureParametersSchema },
  )
  .patch(
    '/api/deploy/:appId/:feature',
    ({ request, params, body }) =>
      updateDeployment(bindings, request, params.appId, params.feature, body as DeploymentUpdateInput),
    { params: AppFeatureParametersSchema, body: DeploymentUpdateSchema },
  )
  .post(
    '/api/uploads',
    ({ request, body }) => registerUpload(bindings, request, body as ReleaseMetadata),
    { body: ReleaseMetadataSchema },
  )
  .post(
    '/api/uploads/:bundleId/complete',
    ({ request, params, body }) =>
      completeUpload(bindings, request, params.bundleId, body as ReleaseMetadata),
    { params: BundleParametersSchema, body: ReleaseMetadataSchema },
  )
  .put(
    '/__local-r2/:appId/:feature/releases/:bundleId/release.zip',
    ({ request, params }) => handleLocalUpload(bindings, request, params.appId, params.feature, params.bundleId),
    { params: AppLocalUploadParametersSchema },
  )
  .all('*', ({ request }) => handlePublicDeliveryRequest(bindings, request))
  .compile();

export default app;
