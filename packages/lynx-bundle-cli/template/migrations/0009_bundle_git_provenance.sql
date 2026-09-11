-- Record the git commit a release was built from, so a Live bundle in the
-- Console is traceable back to source. All four columns are nullable/defaulted:
-- older bundles predate this migration, and a mini-app repository need not be
-- a git work tree at all.
ALTER TABLE bundles ADD COLUMN git_commit TEXT;
ALTER TABLE bundles ADD COLUMN git_branch TEXT;
ALTER TABLE bundles ADD COLUMN git_subject TEXT;
ALTER TABLE bundles ADD COLUMN git_dirty INTEGER NOT NULL DEFAULT 0;
