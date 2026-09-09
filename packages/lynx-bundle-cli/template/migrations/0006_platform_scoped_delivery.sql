PRAGMA foreign_keys = OFF;

ALTER TABLE bundles ADD COLUMN platform TEXT NOT NULL DEFAULT 'ios';

CREATE TABLE host_runtimes (
  app_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  runtime_version TEXT NOT NULL,
  app_version TEXT NOT NULL,
  build_number TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (app_id, platform)
);

INSERT INTO host_runtimes (app_id, platform, runtime_version, app_version, build_number, updated_at)
SELECT id, 'ios', current_runtime_version, current_app_version, current_build_number, CURRENT_TIMESTAMP
FROM apps
WHERE current_runtime_version IS NOT NULL
  AND current_app_version IS NOT NULL
  AND current_build_number IS NOT NULL;

CREATE TABLE deployments_next (
  app_id TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  runtime_version TEXT NOT NULL,
  bundle_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  force INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (app_id, feature_id, platform, runtime_version)
);

INSERT INTO deployments_next (app_id, feature_id, platform, runtime_version, bundle_id, enabled, force, revision, updated_at)
SELECT app_id, feature_id, 'ios', runtime_version, bundle_id, enabled, force, revision, updated_at
FROM deployments;

DROP TABLE deployments;
ALTER TABLE deployments_next RENAME TO deployments;

CREATE INDEX bundles_app_feature_platform_created_at
  ON bundles (app_id, feature_id, platform, created_at DESC);

PRAGMA foreign_keys = ON;
PRAGMA optimize;
