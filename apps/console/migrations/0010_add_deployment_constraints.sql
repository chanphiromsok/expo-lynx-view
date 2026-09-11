-- Migration 0010: Add deployment constraints and indexes
-- Purpose: Improve referential integrity and query performance
-- Date: 2026-09-11

-- 1. Add CHECK constraint on platform and FK on bundle_id
-- Note: SQLite requires table recreation for adding constraints
-- We'll rename the table, recreate with constraints, and copy data

ALTER TABLE deployments RENAME TO deployments_old;

CREATE TABLE deployments (
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  feature_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  runtime_version TEXT NOT NULL,
  bundle_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  force INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (app_id, feature_id, platform, runtime_version),
  -- Foreign key: deployments.bundle_id must reference bundles.id
  -- The app_id is already in this table, so we can check both match
  FOREIGN KEY (app_id, bundle_id) REFERENCES bundles(app_id, id) ON DELETE SET NULL
);

-- Copy data from old table
INSERT INTO deployments
  SELECT * FROM deployments_old;

-- Drop old table
DROP TABLE deployments_old;

-- 2. Add indexes for common queries
-- Index for: "find all deployments using bundle X"
CREATE INDEX deployments_bundle_id ON deployments (app_id, bundle_id);

-- Index for: "get all deployments for feature"
CREATE INDEX deployments_app_feature ON deployments (app_id, feature_id);
