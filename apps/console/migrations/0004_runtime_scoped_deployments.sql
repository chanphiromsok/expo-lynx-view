PRAGMA foreign_keys = OFF;

CREATE TABLE deployments_next (
  app_id TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  runtime_version TEXT NOT NULL,
  bundle_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  force INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (app_id, feature_id, runtime_version)
);

INSERT INTO deployments_next (app_id, feature_id, runtime_version, bundle_id, enabled, force, revision, updated_at)
SELECT d.app_id, d.feature_id, b.runtime_version, d.bundle_id, d.enabled, d.force, d.revision, d.updated_at
FROM deployments d
JOIN bundles b ON b.app_id = d.app_id AND b.id = d.bundle_id AND b.feature_id = d.feature_id;

DROP TABLE deployments;
ALTER TABLE deployments_next RENAME TO deployments;
PRAGMA foreign_keys = ON;
PRAGMA optimize;
