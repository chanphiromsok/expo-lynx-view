-- A release archive is produced by a mini-app and is platform-neutral.
-- Platform/native compatibility belongs exclusively to deployments.
PRAGMA foreign_keys = OFF;

CREATE TABLE bundles_next (
  app_id TEXT NOT NULL,
  id TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  version TEXT NOT NULL,
  archive_object_key TEXT NOT NULL,
  archive_sha256 TEXT NOT NULL,
  archive_bytes INTEGER NOT NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (app_id, id)
);

-- Retain existing artifacts in place. New releases use the platform-neutral
-- key: <app>/<feature>/releases/<release>/release.zip.
INSERT INTO bundles_next (
  app_id, id, feature_id, version, archive_object_key,
  archive_sha256, archive_bytes, verified_at, created_at
)
SELECT
  app_id, id, feature_id, version,
  app_id || '/' || feature_id || '/' || platform || '/releases/' || id || '/release.zip',
  archive_sha256, archive_bytes, verified_at, created_at
FROM bundles;

DROP TABLE bundles;
ALTER TABLE bundles_next RENAME TO bundles;
CREATE INDEX bundles_app_feature_created_at ON bundles (app_id, feature_id, created_at DESC);

-- Scoped deployment documents now point at a platform-neutral archive URL.
-- Advance the signed revision so installed clients never observe a changed
-- document at an already-recorded revision.
UPDATE deployments
SET revision = revision + 1,
    updated_at = CURRENT_TIMESTAMP;

PRAGMA foreign_keys = ON;
PRAGMA optimize;
