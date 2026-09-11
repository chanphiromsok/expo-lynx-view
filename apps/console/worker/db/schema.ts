import { foreignKey, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const apps = sqliteTable('apps', {
  id: text('id').primaryKey().notNull(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
});

export const miniApps = sqliteTable(
  'mini_apps',
  {
    appId: text('app_id').notNull().references(() => apps.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    name: text('name').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.appId, table.id] })],
);

export const hostRuntimes = sqliteTable(
  'host_runtimes',
  {
    appId: text('app_id').notNull().references(() => apps.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(),
    runtimeVersion: text('runtime_version').notNull(),
    appVersion: text('app_version').notNull(),
    buildNumber: text('build_number').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.appId, table.platform] })],
);

export const bundles = sqliteTable(
  'bundles',
  {
    appId: text('app_id').notNull().references(() => apps.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    featureId: text('feature_id').notNull(),
    version: text('version').notNull(),
    archiveObjectKey: text('archive_object_key').notNull(),
    archiveSha256: text('archive_sha256').notNull(),
    archiveBytes: integer('archive_bytes').notNull(),
    verifiedAt: text('verified_at'),
    createdAt: text('created_at').notNull(),
    // Git provenance the release was built from. Nullable: older bundles
    // predate this column, and a mini-app repository need not be a git work
    // tree at all.
    gitCommit: text('git_commit'),
    gitBranch: text('git_branch'),
    gitSubject: text('git_subject'),
    gitDirty: integer('git_dirty', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.appId, table.id] }),
    index('bundles_app_feature_created_at').on(table.appId, table.featureId, table.createdAt),
  ],
);

export const deployments = sqliteTable(
  'deployments',
  {
    appId: text('app_id').notNull().references(() => apps.id, { onDelete: 'cascade' }),
    featureId: text('feature_id').notNull(),
    platform: text('platform').notNull(),
    runtimeVersion: text('runtime_version').notNull(),
    bundleId: text('bundle_id'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    force: integer('force', { mode: 'boolean' }).notNull().default(false),
    revision: integer('revision').notNull().default(0),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.appId, table.featureId, table.platform, table.runtimeVersion] }),
    // bundles' key is the composite (app_id, id); bundleId alone isn't unique
    // across apps, so the FK must reference both columns together.
    foreignKey({
      columns: [table.appId, table.bundleId],
      foreignColumns: [bundles.appId, bundles.id],
    }).onDelete('set null'),
    // Index for: "find all deployments using bundle X"
    index('deployments_bundle_id').on(table.appId, table.bundleId),
  ],
);

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey().notNull(),
    username: text('username').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    apiKeyHash: text('api_key_hash').notNull().unique(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
  },
);
