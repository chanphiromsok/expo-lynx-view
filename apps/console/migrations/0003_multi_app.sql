PRAGMA foreign_keys = OFF;

CREATE TABLE bundles_next (
  app_id TEXT NOT NULL,
  id TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  version TEXT NOT NULL,
  runtime_version TEXT NOT NULL,
  archive_sha256 TEXT NOT NULL,
  archive_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (app_id, id)
);

INSERT INTO bundles_next (app_id, id, feature_id, version, runtime_version, archive_sha256, archive_bytes, created_at)
SELECT 'default', id, feature_id, version, runtime_version, archive_sha256, archive_bytes, created_at FROM bundles;

CREATE TABLE deployments_next (
  app_id TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  bundle_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  force INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (app_id, feature_id)
);

INSERT INTO deployments_next (app_id, feature_id, bundle_id, enabled, force, revision, updated_at)
SELECT 'default', feature_id, bundle_id, enabled, force, revision, updated_at FROM deployments;

DROP TABLE deployments;
DROP TABLE bundles;
ALTER TABLE bundles_next RENAME TO bundles;
ALTER TABLE deployments_next RENAME TO deployments;
CREATE INDEX bundles_app_feature_created_at ON bundles (app_id, feature_id, created_at DESC);
PRAGMA foreign_keys = ON;
PRAGMA optimize;
