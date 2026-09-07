import { env } from 'cloudflare:workers';
import { Elysia } from 'elysia';
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker';

import {
  completeUpload,
  createApp,
  createMiniApp,
  getApps,
  getCurrentUser,
  getDeploymentOverview,
  getDeploymentScopes,
  handleLocalUpload,
  login,
  logout,
  registerUpload,
  registerHostRuntime,
  updateDeployment,
  type ControlEnv,
} from './control-api.ts';
import {
  handlePublicDeliveryRequest,
  type DeliveryEnv,
} from './public-delivery.ts';
import {
  AppCreateSchema,
  AppFeatureParametersSchema,
  AppParametersSchema,
  BundleParametersSchema,
  AppLocalUploadParametersSchema,
  DeploymentUpdateSchema,
  LoginSchema,
  HostRuntimeRegistrationSchema,
  MiniAppCreateSchema,
  type DeploymentUpdateInput,
  type LoginInput,
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
  .get('/api/apps', ({ request }) => getApps(bindings, request))
  .post('/api/apps', ({ request, body }) => createApp(bindings, request, body), { body: AppCreateSchema })
  .post(
    '/api/apps/:appId/mini-apps',
    ({ request, params, body }) => createMiniApp(bindings, request, params.appId, body),
    { params: AppParametersSchema, body: MiniAppCreateSchema },
  )
  .put(
    '/api/apps/:appId/runtime',
    ({ request, params, body }) => registerHostRuntime(bindings, request, params.appId, body),
    { params: AppParametersSchema, body: HostRuntimeRegistrationSchema },
  )
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
    ({ request, body }) => registerUpload(bindings, request, body),
  )
  .post(
    '/api/uploads/:bundleId/complete',
    ({ request, params, body }) =>
      completeUpload(bindings, request, params.bundleId, body),
    { params: BundleParametersSchema },
  )
  .put(
    '/__local-r2/:appId/:feature/:platform/releases/:bundleId/release.zip',
    ({ request, params }) => handleLocalUpload(bindings, request, params.appId, params.feature, params.platform, params.bundleId),
    { params: AppLocalUploadParametersSchema },
  )
  .all('*', ({ request }) => handlePublicDeliveryRequest(bindings, request))
  .compile();

export default app;
