PRAGMA foreign_keys = ON;

CREATE TABLE bundles (
  id TEXT PRIMARY KEY NOT NULL,
  feature_id TEXT NOT NULL,
  version TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  manifest_bytes INTEGER NOT NULL,
  archive_sha256 TEXT NOT NULL,
  archive_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX bundles_feature_created_at
  ON bundles (feature_id, created_at DESC);

CREATE TABLE deployments (
  feature_id TEXT PRIMARY KEY NOT NULL,
  bundle_id TEXT REFERENCES bundles (id),
  enabled INTEGER NOT NULL DEFAULT 0,
  force INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  envelope_text TEXT,
  envelope_sha256 TEXT,
  updated_at TEXT NOT NULL
);
