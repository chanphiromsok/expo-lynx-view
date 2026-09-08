-- Older development installs received a blank "default" app automatically.
-- Delete only a truly empty compatibility placeholder; preserve registrations and releases.
DELETE FROM apps
WHERE id = 'default'
  AND NOT EXISTS (SELECT 1 FROM mini_apps WHERE app_id = 'default')
  AND NOT EXISTS (SELECT 1 FROM bundles WHERE app_id = 'default')
  AND NOT EXISTS (SELECT 1 FROM deployments WHERE app_id = 'default')
  AND NOT EXISTS (SELECT 1 FROM host_runtimes WHERE app_id = 'default');
