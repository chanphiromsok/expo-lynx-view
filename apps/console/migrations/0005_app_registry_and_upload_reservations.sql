CREATE TABLE apps (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  current_runtime_version TEXT,
  current_app_version TEXT,
  current_build_number TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE mini_apps (
  app_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (app_id, id)
);

INSERT OR IGNORE INTO apps (id, name, created_at)
SELECT DISTINCT app_id, CASE WHEN app_id = 'default' THEN 'Default' ELSE app_id END, CURRENT_TIMESTAMP
FROM bundles;

INSERT OR IGNORE INTO apps (id, name, created_at)
SELECT DISTINCT app_id, CASE WHEN app_id = 'default' THEN 'Default' ELSE app_id END, CURRENT_TIMESTAMP
FROM deployments;

INSERT INTO mini_apps (app_id, id, name, created_at)
SELECT app_id, feature_id, feature_id, CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT app_id, feature_id FROM bundles
  UNION
  SELECT DISTINCT app_id, feature_id FROM deployments
);

ALTER TABLE bundles ADD COLUMN verified_at TEXT;
ALTER TABLE bundles ADD COLUMN target_app_version TEXT;
ALTER TABLE bundles ADD COLUMN target_build_number TEXT;

UPDATE bundles
SET verified_at = created_at
WHERE verified_at IS NULL;
