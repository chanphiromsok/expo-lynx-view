-- Still pre-release: no external consumers of apps.current_* / currentHostBuild,
-- so this drops the denormalized snapshot outright instead of phasing it out.
-- host_runtimes is the only source of truth for "current" per platform.
--
-- Also backfills the foreign keys this schema has never had: every table
-- carrying app_id relied on the app layer alone for integrity. SQLite has no
-- ALTER TABLE ADD CONSTRAINT, so each table is rebuilt via the same
-- create-copy-drop-rename pattern used in 0003/0004/0006/0008.
PRAGMA foreign_keys = OFF;

CREATE TABLE apps_next (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO apps_next (id, name, created_at)
SELECT id, name, created_at FROM apps;

DROP TABLE apps;
ALTER TABLE apps_next RENAME TO apps;

CREATE TABLE mini_apps_next (
  app_id TEXT NOT NULL REFERENCES apps (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (app_id, id)
);

INSERT INTO mini_apps_next (app_id, id, name, created_at)
SELECT app_id, id, name, created_at FROM mini_apps;

DROP TABLE mini_apps;
ALTER TABLE mini_apps_next RENAME TO mini_apps;

CREATE TABLE host_runtimes_next (
  app_id TEXT NOT NULL REFERENCES apps (id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  runtime_version TEXT NOT NULL,
  app_version TEXT NOT NULL,
  build_number TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (app_id, platform)
);

INSERT INTO host_runtimes_next (app_id, platform, runtime_version, app_version, build_number, updated_at)
SELECT app_id, platform, runtime_version, app_version, build_number, updated_at FROM host_runtimes;

DROP TABLE host_runtimes;
ALTER TABLE host_runtimes_next RENAME TO host_runtimes;

CREATE TABLE bundles_next (
  app_id TEXT NOT NULL REFERENCES apps (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  version TEXT NOT NULL,
  archive_object_key TEXT NOT NULL,
  archive_sha256 TEXT NOT NULL,
  archive_bytes INTEGER NOT NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  git_commit TEXT,
  git_branch TEXT,
  git_subject TEXT,
  git_dirty INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (app_id, id)
);

INSERT INTO bundles_next (
  app_id, id, feature_id, version, archive_object_key, archive_sha256, archive_bytes,
  verified_at, created_at, git_commit, git_branch, git_subject, git_dirty
)
SELECT
  app_id, id, feature_id, version, archive_object_key, archive_sha256, archive_bytes,
  verified_at, created_at, git_commit, git_branch, git_subject, git_dirty
FROM bundles;

DROP TABLE bundles;
ALTER TABLE bundles_next RENAME TO bundles;
CREATE INDEX bundles_app_feature_created_at ON bundles (app_id, feature_id, created_at DESC);

CREATE TABLE deployments_next (
  app_id TEXT NOT NULL REFERENCES apps (id) ON DELETE CASCADE,
  feature_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  runtime_version TEXT NOT NULL,
  bundle_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  force INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (app_id, feature_id, platform, runtime_version),
  -- bundles' key is the composite (app_id, id); bundle_id alone isn't unique
  -- across apps, so this must reference both columns together.
  FOREIGN KEY (app_id, bundle_id) REFERENCES bundles (app_id, id) ON DELETE SET NULL
);

INSERT INTO deployments_next (app_id, feature_id, platform, runtime_version, bundle_id, enabled, force, revision, updated_at)
SELECT app_id, feature_id, platform, runtime_version, bundle_id, enabled, force, revision, updated_at FROM deployments;

DROP TABLE deployments;
ALTER TABLE deployments_next RENAME TO deployments;
-- Deployments are looked up by (app_id, feature_id, ...), already covered by
-- the primary key above; only bundle_id needs its own index.
CREATE INDEX deployments_bundle_id ON deployments (app_id, bundle_id);

PRAGMA foreign_keys = ON;
PRAGMA optimize;
