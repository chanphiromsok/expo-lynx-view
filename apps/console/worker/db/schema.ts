import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const bundles = sqliteTable(
  'bundles',
  {
    id: text('id').primaryKey().notNull(),
    featureId: text('feature_id').notNull(),
    version: text('version').notNull(),
    runtimeVersion: text('runtime_version').notNull(),
    archiveSha256: text('archive_sha256').notNull(),
    archiveBytes: integer('archive_bytes').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('bundles_feature_created_at').on(table.featureId, table.createdAt)],
);

export const deployments = sqliteTable('deployments', {
  featureId: text('feature_id').primaryKey().notNull(),
  bundleId: text('bundle_id').references(() => bundles.id),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  force: integer('force', { mode: 'boolean' }).notNull().default(false),
  revision: integer('revision').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
});
