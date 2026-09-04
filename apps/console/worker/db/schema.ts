import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const bundles = sqliteTable(
  'bundles',
  {
    appId: text('app_id').notNull(),
    id: text('id').notNull(),
    featureId: text('feature_id').notNull(),
    version: text('version').notNull(),
    runtimeVersion: text('runtime_version').notNull(),
    archiveSha256: text('archive_sha256').notNull(),
    archiveBytes: integer('archive_bytes').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.appId, table.id] }),
    index('bundles_app_feature_created_at').on(table.appId, table.featureId, table.createdAt),
  ],
);

export const deployments = sqliteTable(
  'deployments',
  {
    appId: text('app_id').notNull(),
    featureId: text('feature_id').notNull(),
    bundleId: text('bundle_id'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    force: integer('force', { mode: 'boolean' }).notNull().default(false),
    revision: integer('revision').notNull().default(0),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.appId, table.featureId] })],
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
