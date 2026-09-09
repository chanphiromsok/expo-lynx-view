import { Type, type Static } from '@sinclair/typebox';

export const featurePattern = '^[a-z][a-z0-9-]{0,63}$';
export const appPattern = '^[a-z][a-z0-9-]{0,63}$';
export const bundlePattern = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
export const sha256Pattern = '^[a-f0-9]{64}$';
export const platformPattern = '^(ios|android)$';

export const FeatureParametersSchema = Type.Object({
  feature: Type.String({ pattern: featurePattern }),
});

export const AppFeatureParametersSchema = Type.Object({
  appId: Type.String({ pattern: appPattern }),
  feature: Type.String({ pattern: featurePattern }),
});

export const AppParametersSchema = Type.Object({
  appId: Type.String({ pattern: appPattern }),
});

export const BundleParametersSchema = Type.Object({
  bundleId: Type.String({ pattern: bundlePattern }),
});

export const LocalUploadParametersSchema = Type.Object({
  feature: Type.String({ pattern: featurePattern }),
  bundleId: Type.String({ pattern: bundlePattern }),
});

export const AppLocalUploadParametersSchema = Type.Object({
  appId: Type.String({ pattern: appPattern }),
  feature: Type.String({ pattern: featurePattern }),
  bundleId: Type.String({ pattern: bundlePattern }),
});

export const MiniAppReleaseSchema = Type.Object(
  {
    schemaVersion: Type.Literal(3),
    appId: Type.String({ pattern: appPattern }),
    feature: Type.String({ pattern: featurePattern }),
    releaseId: Type.String({ pattern: bundlePattern }),
    version: Type.String({ minLength: 1, maxLength: 128 }),
    archiveSha256: Type.String({ pattern: sha256Pattern }),
    archiveBytes: Type.Integer({ minimum: 1, maximum: 64 * 1024 * 1024 }),
  },
  { additionalProperties: false },
);

export const AppCreateSchema = Type.Object(
  {
    id: Type.String({ pattern: appPattern }),
    name: Type.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false },
);

export const MiniAppCreateSchema = Type.Object(
  {
    id: Type.String({ pattern: featurePattern }),
    name: Type.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false },
);

export const HostRuntimeRegistrationSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    platform: Type.String({ pattern: platformPattern }),
    runtimeVersion: Type.String({ minLength: 1, maxLength: 128, pattern: '^[\\u0020-\\u007e]+$' }),
    appVersion: Type.String({ minLength: 1, maxLength: 128, pattern: '^[\\u0020-\\u007e]+$' }),
    buildNumber: Type.String({ minLength: 1, maxLength: 128, pattern: '^[\\u0020-\\u007e]+$' }),
    features: Type.Array(Type.String({ pattern: featurePattern }), { minItems: 1, maxItems: 64, uniqueItems: true }),
  },
  { additionalProperties: false },
);

// Keep this a single object rather than a Type.Union: the local Elysia setup
// intentionally does not install TypeBox's compiler dependency. The controller
// selects either operation after TypeBox has validated each supplied field.
export const DeploymentUpdateSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    bundleId: Type.Optional(Type.String({ pattern: bundlePattern })),
    force: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false, minProperties: 1 },
);

export const LoginSchema = Type.Object(
  {
    username: Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$' }),
    password: Type.String({ minLength: 1, maxLength: 1024 }),
  },
  { additionalProperties: false },
);

export type FeatureParameters = Static<typeof FeatureParametersSchema>;
export type AppFeatureParameters = Static<typeof AppFeatureParametersSchema>;
export type AppParameters = Static<typeof AppParametersSchema>;
export type BundleParameters = Static<typeof BundleParametersSchema>;
export type LocalUploadParameters = Static<typeof LocalUploadParametersSchema>;
export type AppLocalUploadParameters = Static<typeof AppLocalUploadParametersSchema>;
export type MiniAppRelease = Static<typeof MiniAppReleaseSchema>;
export type AppCreateInput = Static<typeof AppCreateSchema>;
export type MiniAppCreateInput = Static<typeof MiniAppCreateSchema>;
export type HostRuntimeRegistrationInput = Static<typeof HostRuntimeRegistrationSchema>;
export type DeploymentUpdateInput = Static<typeof DeploymentUpdateSchema>;
export type LoginInput = Static<typeof LoginSchema>;
export type DeliveryPlatform = 'ios' | 'android';
