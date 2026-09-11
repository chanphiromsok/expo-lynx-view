-- Migration 0011: Add platform CHECK constraints to host_runtimes
-- Purpose: Ensure platform column only contains valid values (ios | android)
-- Date: 2026-09-11

-- Recreate host_runtimes with CHECK constraint on platform
ALTER TABLE host_runtimes RENAME TO host_runtimes_old;

CREATE TABLE host_runtimes (
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  runtime_version TEXT NOT NULL,
  app_version TEXT NOT NULL,
  build_number TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (app_id, platform)
);

-- Copy data from old table
INSERT INTO host_runtimes
  SELECT * FROM host_runtimes_old;

-- Drop old table
DROP TABLE host_runtimes_old;

-- Add index for common queries
CREATE INDEX host_runtimes_app ON host_runtimes (app_id);
