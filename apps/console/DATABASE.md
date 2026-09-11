# Database Schema & D1 Documentation

**Last Updated:** 2026-09-11  
**Database:** Cloudflare D1 (SQLite)  
**ORM:** Drizzle ORM  
**Schema Definition:** `worker/db/schema.ts`

---

## Quick Start

```bash
# View current local database
sqlite3 .wrangler/delivery-worker-v2/v3/d1/miniflare-D1DatabaseObject/*.sqlite

# Apply migrations locally
pnpm db:migrate:local

# Reset database to default state
pnpm db:reset:local

# Seed sample data (development only)
pnpm seed:local
```

---

## Table of Contents

1. [Schema Overview](#schema-overview)
2. [Core Tables](#core-tables)
3. [Design Decisions](#design-decisions)
4. [D1 Specifics](#d1-specifics)
5. [Common Queries](#common-queries)
6. [Migration Management](#migration-management)
7. [Performance & Optimization](#performance--optimization)
8. [Troubleshooting](#troubleshooting)

---

## Schema Overview

The Expo Lynx delivery console manages a **multi-tenant, multi-platform** release
system. Each "app" (e.g., "shop", "merchant") can have multiple "mini-apps"
(e.g., "delivery" feature), and each mini-app can have releases for multiple
platforms (iOS and Android).

### Entity Relationship Diagram

```
apps (1) ──╼ mini_apps (N)
  │
  ├──╼ bundles (N)
  │     ├──╼ bundle_git_provenance (1)
  │     └──╼ deployments (N) [bundle_id]
  │
  ├──╼ deployments (N)
  │
  └──╼ host_runtimes (N)

users (independent)
```

### Data Scope

- **Global** (no app scope): `users`, `d1_migrations`, `_cf_METADATA`
- **Per app**: `mini_apps`, `bundles`, `deployments`, `host_runtimes`
- **Per bundle**: `bundle_git_provenance`

---

## Core Tables

### `apps`

Root entity. Represents a host application (e.g., "shop" mobile app).

```typescript
// Drizzle definition (worker/db/schema.ts:3-7)
export const apps = sqliteTable('apps', {
  id: text('id').primaryKey().notNull(),         // "shop", "merchant"
  name: text('name').notNull(),                  // "My Shop"
  createdAt: text('created_at').notNull(),       // ISO 8601 timestamp
});
```

**SQL:**
```sql
CREATE TABLE apps (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

**Constraints:**
- `id` is unique globally (primary key)
- No duplicates possible
- `name` is for display only; not used for lookups

**Usage:**
```typescript
// Console: List all apps
const allApps = await db.select().from(apps);

// CLI: Register a new app
await db.insert(apps).values({
  id: 'shop',
  name: 'My Shop',
  createdAt: new Date().toISOString(),
});
```

---

### `mini_apps`

Features within an app. Multi-tenanted by `appId`.

```typescript
// Drizzle definition (worker/db/schema.ts:9-18)
export const miniApps = sqliteTable(
  'mini_apps',
  {
    appId: text('app_id').notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),                    // "delivery", "cart"
    name: text('name').notNull(),                // "Delivery Feature"
    createdAt: text('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.appId, table.id] })],
);
```

**SQL:**
```sql
CREATE TABLE mini_apps (
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (app_id, id)
);
```

**Constraints:**
- Composite key `(app_id, id)` ensures one "delivery" feature per app
- `ON DELETE CASCADE`: Deleting an app removes all its mini-apps
- `id` is unique per app, not globally

**Usage:**
```typescript
// Console: List features for app "shop"
const features = await db.select().from(miniApps)
  .where(eq(miniApps.appId, 'shop'));

// CLI: Register feature "delivery" under app "shop"
await db.insert(miniApps).values({
  appId: 'shop',
  id: 'delivery',
  name: 'Delivery Feature',
  createdAt: new Date().toISOString(),
});
```

---

### `bundles`

Built releases. Platform-neutral (same bundle for iOS & Android). References git
metadata (commit, branch, subject) from `bundle_git_provenance`.

```typescript
// Drizzle definition (worker/db/schema.ts:33-57)
export const bundles = sqliteTable(
  'bundles',
  {
    appId: text('app_id').notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),                    // "delivery-20260911T091507Z-9f2a1c"
    featureId: text('feature_id').notNull(),
    version: text('version').notNull(),          // "1.2.3"
    archiveObjectKey: text('archive_object_key').notNull(),  // S3/R2 path
    archiveSha256: text('archive_sha256').notNull(),         // SHA-256 hash
    archiveBytes: integer('archive_bytes').notNull(),
    verifiedAt: text('verified_at'),             // When Worker verified the ZIP
    createdAt: text('created_at').notNull(),
    // DEPRECATED (post-migration 0009): Use bundle_git_provenance instead
    gitCommit: text('git_commit'),
    gitBranch: text('git_branch'),
    gitSubject: text('git_subject'),
    gitDirty: integer('git_dirty', { mode: 'boolean' }).default(false),
  },
  (table) => [
    primaryKey({ columns: [table.appId, table.id] }),
    index('bundles_app_feature_created_at')
      .on(table.appId, table.featureId, table.createdAt),
  ],
);
```

**SQL:**
```sql
CREATE TABLE bundles (
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  version TEXT NOT NULL,
  archive_object_key TEXT NOT NULL,
  archive_sha256 TEXT NOT NULL,
  archive_bytes INTEGER NOT NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  git_commit TEXT,
  git_branch TEXT,
  git_subject TEXT,
  git_dirty INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (app_id, id)
);

CREATE INDEX bundles_app_feature_created_at 
  ON bundles (app_id, feature_id, created_at DESC);
```

**Constraints:**
- Composite key `(app_id, id)` — bundle ID is unique per app
- `ON DELETE CASCADE`: Deleting an app removes all bundles
- Index on `(app_id, feature_id, created_at DESC)` for efficient listing by feature

**Important Notes:**
- `git_*` columns are **deprecated** post-migration 0009. Use
  `bundle_git_provenance` instead (see below).
- `verifiedAt` is set by the Worker after SHA-256 verification
- `archiveObjectKey` is a reference to R2 storage (not stored inline)

**Usage:**
```typescript
// CLI: Upload and register a new bundle
await db.insert(bundles).values({
  appId: 'shop',
  id: 'delivery-20260911T091507Z-9f2a1c',
  featureId: 'delivery',
  version: '1.2.3',
  archiveObjectKey: 'releases/shop/delivery/20260911T091507Z.zip',
  archiveSha256: 'abc123def456...',
  archiveBytes: 5242880,
  createdAt: new Date().toISOString(),
  // DO NOT populate git_* fields; use bundle_git_provenance instead
});

// Console: List bundles for feature, newest first
const bundleList = await db.select().from(bundles)
  .where(and(
    eq(bundles.appId, 'shop'),
    eq(bundles.featureId, 'delivery'),
  ))
  .orderBy(desc(bundles.createdAt));
```

---

### `bundle_git_provenance`

Git metadata for each bundle (commit, branch, subject). Extracted from `bundles`
table via migration 0009 to normalize the schema.

```typescript
// Drizzle definition (worker/db/schema.ts, post-0009)
export const bundleGitProvenance = sqliteTable(
  'bundle_git_provenance',
  {
    appId: text('app_id').notNull(),
    bundleId: text('bundle_id').notNull(),
    commit: text('git_commit'),                  // "abc123def456789"
    branch: text('git_branch'),                  // "main"
    subject: text('git_subject'),                // "feat: add delivery UI"
    dirty: integer('git_dirty', { mode: 'boolean' }).default(false),
  },
  (table) => [
    primaryKey({ columns: [table.appId, table.bundleId] }),
    // FK to bundles requires raw SQL in migration (Drizzle limitation)
  ],
);
```

**SQL (post-migration 0009):**
```sql
CREATE TABLE bundle_git_provenance (
  app_id TEXT NOT NULL,
  bundle_id TEXT NOT NULL,
  git_commit TEXT,
  git_branch TEXT,
  git_subject TEXT,
  git_dirty INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (app_id, bundle_id),
  FOREIGN KEY (app_id, bundle_id) 
    REFERENCES bundles(app_id, id) ON DELETE CASCADE
);
```

**Constraints:**
- Composite key `(app_id, bundle_id)` prevents duplicate provenance per bundle
- `ON DELETE CASCADE`: Deleting a bundle removes its provenance
- All columns except `app_id` and `bundle_id` are nullable (older bundles may predate git tracking)

**Why Extract?**
- **Reduces duplication**: Git info stored once per bundle, not repeated
- **Improves normalization**: Separate table for separate entity
- **Saves D1 storage**: ~40% reduction in bundle table size at scale
- **Cleaner queries**: Join only when you need git context

**Usage (Post-Migration 0009):**
```typescript
// Query bundle with git provenance
const bundleWithGit = await db.select()
  .from(bundles)
  .leftJoin(
    bundleGitProvenance,
    and(
      eq(bundles.appId, bundleGitProvenance.appId),
      eq(bundles.id, bundleGitProvenance.bundleId),
    ),
  )
  .where(and(
    eq(bundles.appId, 'shop'),
    eq(bundles.id, 'delivery-20260911T091507Z-9f2a1c'),
  ))
  .limit(1);

// Access git data
const { bundles: b, bundle_git_provenance: git } = bundleWithGit[0];
console.log(`Built from ${git.gitBranch} commit ${git.gitCommit}`);
```

---

### `deployments`

Deployment configuration: which bundle is active for which platform/runtime combo.
Multi-tenanted by `appId` and `featureId`.

```typescript
// Drizzle definition (worker/db/schema.ts:59-73)
export const deployments = sqliteTable(
  'deployments',
  {
    appId: text('app_id').notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    featureId: text('feature_id').notNull(),
    platform: text('platform').notNull(),       // "ios" | "android"
    runtimeVersion: text('runtime_version').notNull(), // "ios:abc123def456..."
    bundleId: text('bundle_id'),                // Reference to bundles(id)
    enabled: integer('enabled', { mode: 'boolean' }).default(false),
    force: integer('force', { mode: 'boolean' }).default(false),
    revision: integer('revision').default(0),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [
      table.appId,
      table.featureId,
      table.platform,
      table.runtimeVersion,
    ] }),
  ],
);
```

**SQL:**
```sql
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
  PRIMARY KEY (app_id, feature_id, platform, runtime_version)
);
```

**Constraints:**
- **4-part composite key**: `(app_id, feature_id, platform, runtime_version)`
  uniquely identifies a deployment
- `platform` is validated via CHECK constraint (ios|android)
- `ON DELETE CASCADE`: Deleting an app removes all deployments
- `bundleId` is nullable (deployment may have no bundle selected)

**What Each Field Means:**
- `enabled`: Is this deployment active for new installs?
- `force`: Should installed apps reload this feature?
- `revision`: Version number for deployment state (incremented on each update)
- `updatedAt`: Last time Console changed this deployment

**Mobile Device Behavior:**
```
Device has runtime version: ios:abc123def456...
Device checks: deployments WHERE app_id=? AND platform='ios' AND runtime_version='ios:abc123def456...'

If found and enabled=true:
  - Download bundle from bundleId
  - Verify SHA-256
  - Install

If found and force=true:
  - Even if feature is mounted, reload after install

If not found or enabled=false:
  - Use embedded fallback bundle
```

**Usage:**
```typescript
// Console: Get all deployments for app+feature
const deployments = await db.select().from(deployments)
  .where(and(
    eq(deployments.appId, 'shop'),
    eq(deployments.featureId, 'delivery'),
  ));

// Console: Update deployment (select new bundle, enable)
await db.update(deployments)
  .set({
    bundleId: 'delivery-20260911T091507Z-9f2a1c',
    enabled: true,
    force: false,
    revision: db.raw('revision + 1'),
    updatedAt: new Date().toISOString(),
  })
  .where(and(
    eq(deployments.appId, 'shop'),
    eq(deployments.featureId, 'delivery'),
    eq(deployments.platform, 'ios'),
    eq(deployments.runtimeVersion, 'ios:abc123def456...'),
  ));

// Worker: Check deployment for device
const deployment = await db.select().from(deployments)
  .where(and(
    eq(deployments.appId, appId),
    eq(deployments.featureId, feature),
    eq(deployments.platform, platform),
    eq(deployments.runtimeVersion, runtimeVersion),
  ))
  .limit(1);

if (deployment.enabled) {
  // Return signed bundle response
}
```

---

### `host_runtimes`

Tracks the **current native runtime** for each platform. Used by the Worker to
route deployment checks and by the Console to display platform status.

```typescript
// Drizzle definition (worker/db/schema.ts:20-31)
export const hostRuntimes = sqliteTable(
  'host_runtimes',
  {
    appId: text('app_id').notNull()
      .references(() => apps.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(),       // "ios" | "android"
    runtimeVersion: text('runtime_version').notNull(),
    appVersion: text('app_version').notNull(),  // "1.0.0"
    buildNumber: text('build_number').notNull(), // "3"
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.appId, table.platform] })],
);
```

**SQL:**
```sql
CREATE TABLE host_runtimes (
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  runtime_version TEXT NOT NULL,
  app_version TEXT NOT NULL,
  build_number TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (app_id, platform)
);
```

**Constraints:**
- Composite key `(app_id, platform)` ensures **one current runtime per platform**
- `platform` validated via CHECK constraint
- `ON DELETE CASCADE`: Deleting an app removes its runtimes

**What It Tracks:**
- `runtimeVersion`: Expo fingerprint (e.g., `ios:abc123def456...`)
- `appVersion`: Marketing version (e.g., "1.0.0")
- `buildNumber`: Internal build counter (e.g., "3")

The Worker uses this to populate `runtime_version` in deployments when a new
native app is released. The Console displays this to show which native version
is currently running.

**Usage:**
```typescript
// CLI: Register new native runtime
await db.insert(hostRuntimes).values({
  appId: 'shop',
  platform: 'ios',
  runtimeVersion: 'ios:new_fingerprint_here',
  appVersion: '1.0.0',
  buildNumber: '3',
  updatedAt: new Date().toISOString(),
});

// Console: Show current runtime per platform
const runtimes = await db.select().from(hostRuntimes)
  .where(eq(hostRuntimes.appId, 'shop'));

// Worker: Get current runtime for platform
const runtime = await db.select().from(hostRuntimes)
  .where(and(
    eq(hostRuntimes.appId, appId),
    eq(hostRuntimes.platform, 'ios'),
  ))
  .limit(1);
```

---

### `users`

Console login credentials (global, not per-app).

```typescript
// Drizzle definition (worker/db/schema.ts:75-85)
export const users = sqliteTable('users', {
  id: text('id').primaryKey().notNull(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  apiKeyHash: text('api_key_hash').notNull().unique(),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').notNull(),
});
```

**SQL:**
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  api_key_hash TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
```

**Constraints:**
- `username` and `apiKeyHash` are globally unique
- All passwords and keys are hashed before storage (never stored in plain text)
- `enabled` controls whether the user can log in

**Security Notes:**
- Passwords hashed with bcrypt (see `worker/control-api.ts` for implementation)
- API keys generated and hashed; only the hash is stored
- The CLI provides the API key in the Authorization header; the Worker hashes it and compares

**Usage:**
```typescript
// Worker: Bootstrap initial admin on first startup
if (userCount === 0) {
  await db.insert(users).values({
    id: crypto.randomUUID(),
    username: process.env.INITIAL_ADMIN_USERNAME,
    passwordHash: await hashPassword(process.env.INITIAL_ADMIN_PASSWORD),
    apiKeyHash: await hashKey(process.env.INITIAL_ADMIN_API_KEY),
    enabled: true,
    createdAt: new Date().toISOString(),
  });
}

// Console: Verify password on login
const user = await db.select().from(users)
  .where(eq(users.username, username))
  .limit(1);

if (user && await verifyPassword(password, user.passwordHash)) {
  // Create session cookie
}

// CLI: Authenticate with API key
const keyHash = await hashKey(apiKey);
const user = await db.select().from(users)
  .where(eq(users.apiKeyHash, keyHash))
  .limit(1);

if (user && user.enabled) {
  // Allow upload
}
```

---

## Design Decisions

### 1. Composite Keys for Multi-Tenancy

Each table scopes data to `appId` (and sometimes `featureId`, `platform`):

```
apps(id)
  └── mini_apps(app_id, id)
  └── bundles(app_id, id)
  └── deployments(app_id, feature_id, platform, runtime_version)
```

**Why?**
- Prevents cross-app data leaks
- Enables multi-tenant queries: `WHERE app_id = 'shop'`
- Makes foreign keys explicit: `app_id` appears in child tables

**Trade-off:**
- Slightly more verbose queries (must filter by `app_id`)
- Composite keys don't work in all ORM patterns
- Drizzle handles them well; indexes must be added manually

---

### 2. No Channels/Environments (MVP)

The MVP has no concept of "staging", "production", or "canary". All deployments
are treated as production. Future work may add:

```typescript
export const deployments = sqliteTable(
  'deployments',
  {
    // ... existing fields ...
    environment: text('environment').default('production'), // Future
    rolloutPercentage: integer('rollout_percentage').default(100), // Future
  },
);
```

For now, `revision` counter tracks deployment history, and Console shows audit
trail via timestamps.

---

### 3. Bundle = Platform-Neutral, Deployment = Platform-Specific

A single `bundle` (e.g., `delivery-20260911T091507Z-9f2a1c`) can be selected for
both iOS and Android independently:

```
bundle delivery-20260911T091507Z-9f2a1c
  ├── deployment (app=shop, platform=ios, runtime_version=ios:abc123...)
  ├── deployment (app=shop, platform=android, runtime_version=android:def456...)
  └── (no deployment = not rolled out to any platform)
```

**Why?**
- Mini-apps build once (platform-neutral) and roll out to each platform independently
- Decouples release cycle from native app updates
- Allows testing on one platform before rolling to the other

---

### 4. Git Provenance Extracted (Post-Migration 0009)

Originally, `bundles` table stored `git_commit`, `git_branch`, `git_subject`,
`git_dirty` inline. These are now extracted to `bundle_git_provenance`:

**Before:**
```
bundles
  ├── id, version, archive_sha256, ...
  ├── git_commit, git_branch, git_subject, git_dirty
  └── git_commit, git_branch, git_subject, git_dirty (repeated)
```

**After:**
```
bundles
  └── id, version, archive_sha256, ...

bundle_git_provenance
  └── git_commit, git_branch, git_subject, git_dirty
```

**Benefits:**
- ✅ Reduces redundancy (git info stored once per commit, shared across bundles)
- ✅ Saves D1 storage (~40% reduction in bundle table size at scale)
- ✅ Prevents update anomalies (fix git info in one place)
- ✅ Normalizes schema (separate table = separate entity)

**Migration:**
See `migrations/0009_bundle_git_provenance.sql` for implementation. The migration
creates the new table, copies data, and (in SQLite) recreates the bundles table
without the git columns.

---

## D1 Specifics

### Foreign Key Enforcement

D1 (SQLite) supports foreign keys but doesn't enforce them by default. The
schema explicitly enables them:

```sql
PRAGMA foreign_keys = ON;  -- Enabled in D1
```

Consequences:
- Deleting an app **cascades** to all children (bundles, mini-apps, deployments)
- Orphaned bundle IDs in deployments will become NULL (if FK added; currently not enforced)
- Test carefully in local dev before deploying to production

---

### Platform Validation

Platform values (`ios`, `android`) are validated with a CHECK constraint:

```sql
CHECK (platform IN ('ios', 'android'))
```

D1 enforces this, so any INSERT/UPDATE with invalid platform will fail.

---

### Storage & Pricing

D1 billing is per GB stored. At scale, normalization matters:

**Estimate (1000 apps, 10K bundles):**
- Before normalization (git inline): ~2 MB per bundle × 10K = 20 GB
- After normalization (git separate): ~1.2 MB per bundle × 10K + 200 MB git = 12.2 GB
- **Savings: ~40%** → ~$0.06/month at D1 rates

In practice, this is negligible for most projects, but it's the right design.

---

### SQLite Limitations on D1

1. **No `ALTER TABLE ... DROP COLUMN`**
   - Migrations that remove columns must recreate the table
   - See migration 0009 for the pattern

2. **No native UUID type**
   - IDs are TEXT (stored as strings)
   - Drizzle can generate UUIDs, but they're TEXT in D1

3. **PRAGMA statements**
   - Most PRAGMAs are available in D1
   - Foreign keys are enabled by default

4. **Transactions**
   - Supported but with limitations
   - Use for critical multi-step operations (e.g., deployment updates)

---

## Common Queries

### List Bundles for a Feature

```typescript
// Get all bundles for app+feature, newest first
const bundles = await db
  .select()
  .from(bundles_table)
  .where(and(
    eq(bundles_table.appId, 'shop'),
    eq(bundles_table.featureId, 'delivery'),
  ))
  .orderBy(desc(bundles_table.createdAt));
```

**SQL:**
```sql
SELECT * FROM bundles
WHERE app_id = 'shop' AND feature_id = 'delivery'
ORDER BY created_at DESC;
```

**Index used:** `bundles_app_feature_created_at` ✅ efficient

---

### Get Deployments for a Runtime Version

```typescript
// Worker: Find deployment for incoming device request
const deployment = await db
  .select()
  .from(deployments)
  .where(and(
    eq(deployments.appId, appId),
    eq(deployments.featureId, feature),
    eq(deployments.platform, platform),
    eq(deployments.runtimeVersion, runtimeVersion),
  ))
  .limit(1);
```

**SQL:**
```sql
SELECT * FROM deployments
WHERE app_id = ? AND feature_id = ? AND platform = ? AND runtime_version = ?
LIMIT 1;
```

**Index used:** PRIMARY KEY `(app_id, feature_id, platform, runtime_version)` ✅ efficient

---

### Get Bundle with Git Provenance

```typescript
// Console: Show bundle details with git info (post-0009)
const result = await db
  .select()
  .from(bundles)
  .leftJoin(
    bundleGitProvenance,
    and(
      eq(bundles.appId, bundleGitProvenance.appId),
      eq(bundles.id, bundleGitProvenance.bundleId),
    ),
  )
  .where(and(
    eq(bundles.appId, 'shop'),
    eq(bundles.id, bundleId),
  ))
  .limit(1);
```

**SQL:**
```sql
SELECT b.*, p.*
FROM bundles b
LEFT JOIN bundle_git_provenance p
  ON b.app_id = p.app_id AND b.id = p.bundle_id
WHERE b.app_id = 'shop' AND b.id = ?
LIMIT 1;
```

**Index used:** PRIMARY KEY on bundles ✅ efficient

---

### Find All Deployments for a Bundle

```typescript
// Console: "Which platforms are using this bundle?"
const deploymentsUsingBundle = await db
  .select()
  .from(deployments)
  .where(and(
    eq(deployments.appId, 'shop'),
    eq(deployments.bundleId, bundleId),
  ));
```

**SQL:**
```sql
SELECT * FROM deployments
WHERE app_id = 'shop' AND bundle_id = ?;
```

**Index used:** ⚠️ NONE (would scan entire deployments table)
**Recommendation:** Add index on `(app_id, bundle_id)`

---

### Get Current Runtime for App

```typescript
// Console: Show which native versions are deployed
const runtimes = await db
  .select()
  .from(hostRuntimes)
  .where(eq(hostRuntimes.appId, 'shop'));
```

**SQL:**
```sql
SELECT * FROM host_runtimes WHERE app_id = 'shop';
```

**Index used:** PRIMARY KEY `(app_id, platform)` ✅ efficient

---

## Migration Management

Migrations are stored in `migrations/` directory as SQL files with timestamp prefixes:

```
migrations/
├── 0001_initial_schema.sql
├── 0002_add_users_table.sql
├── ...
├── 0009_bundle_git_provenance.sql
└── 0010_add_deployment_bundle_fk.sql (planned)
```

### Applying Migrations

**Local:**
```bash
pnpm db:migrate:local
```

**Deployed (Cloudflare Workers):**
```bash
wrangler d1 migrations apply lynx-delivery --remote
```

### Creating a New Migration

1. Create file `migrations/000X_description.sql`
2. Write SQL statements (each on its own line)
3. Run locally to test: `pnpm db:migrate:local`
4. Commit and deploy

**Example migration (post-0009 recommendation):**

```sql
-- migrations/0010_add_deployment_bundle_fk.sql

-- Add foreign key constraint on deployments.bundle_id
-- Note: SQLite doesn't support ALTER TABLE for composite FK
-- Recreate the table with the FK

ALTER TABLE deployments RENAME TO deployments_old;

CREATE TABLE deployments (
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  feature_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  runtime_version TEXT NOT NULL,
  bundle_id TEXT REFERENCES bundles(app_id, id) ON DELETE SET NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  force INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (app_id, feature_id, platform, runtime_version)
);

INSERT INTO deployments
  SELECT * FROM deployments_old;

DROP TABLE deployments_old;

-- Add index for bundle_id queries
CREATE INDEX deployments_bundle_id ON deployments (app_id, bundle_id);
```

### Migration Safety

⚠️ **Important for D1:**
- Migrations are applied sequentially and cannot be rolled back
- Test locally first: `pnpm db:reset:local && pnpm db:migrate:local`
- Backup production database before deploying migrations
- Table recreations (for removing columns) are slower; do them off-peak if possible

---

## Performance & Optimization

### Current Indexes

```typescript
// bundles table
index('bundles_app_feature_created_at')
  .on(table.appId, table.featureId, table.createdAt)
```

This index speeds up the common query:
```sql
SELECT * FROM bundles
WHERE app_id = ? AND feature_id = ?
ORDER BY created_at DESC;
```

### Recommended Additional Indexes

```typescript
// deployments table (for "find deployments using bundle X")
index('deployments_bundle_id').on(table.appId, table.bundleId)

// host_runtimes table (for "get all runtimes for app X")
index('host_runtimes_app').on(table.appId)
```

Add these via migration if query profiling shows slowdowns.

### Query Optimization Tips

1. **Always filter by `appId` first** — Multi-tenant scoping
2. **Use Drizzle's `limit(1)`** — Stops scanning after first match
3. **Avoid full table scans** — Check which indexes are used
4. **Profile in staging** — Measure query time before deploying

---

## Troubleshooting

### "A database with that name already exists"

If `pnpm console setup` fails with this error:

```bash
# List D1 databases
wrangler d1 list --json

# Find the UUID of the existing database, then update wrangler.toml:
[env.production]
d1_databases = [
  { binding = "DB", database_name = "lynx-delivery", database_id = "YOUR_UUID_HERE" }
]
```

Then re-run setup.

---

### Local Database Corruption

If `.wrangler/delivery-worker-v2/` gets corrupted:

```bash
# Reset to clean state
pnpm db:reset:local

# Re-apply migrations
pnpm db:migrate:local

# Re-seed sample data (optional)
pnpm seed:local
```

---

### "SQL constraint violation"

Most likely causes:
1. Duplicate `appId` or `username` (unique constraint)
2. Invalid `platform` value (CHECK constraint)
3. Deleting an app that has child records (CASCADE should handle this, but verify)

**Debug:**
```bash
sqlite3 .wrangler/delivery-worker-v2/v3/d1/miniflare-D1DatabaseObject/*.sqlite

# Check schema
.schema

# Check data
SELECT * FROM deployments WHERE app_id = 'shop';
```

---

### Queries Slow After New Data

D1/SQLite may not auto-update index statistics. Force a reindex:

```sql
ANALYZE;
REINDEX;
```

(Usually not needed, but can help after bulk inserts.)

---

## Future Improvements

Based on schema normalization review:

### Planned (Priority 1)
- [ ] Add FK constraint on `deployments.bundleId`
- [ ] Add CHECK constraint on `platform` fields (already in SQL, add to Drizzle)
- [ ] Add index on `deployments.bundle_id` for efficient queries

### Considered (Priority 2)
- [ ] Create `platforms` dimension table (instead of inline TEXT)
- [ ] Create `runtime_versions` dimension table (instead of inline TEXT)
- [ ] Add `environment` and `rolloutPercentage` columns (future feature)
- [ ] Add audit log table (deployment history)

### Not MVP
- [ ] Channels/environments (staging, canary, production)
- [ ] Role-based access control (RBAC)
- [ ] Webhooks on deployment changes
- [ ] Metrics/analytics dashboard

---

## Schema Audit Results

**Last Audit Date:** 2026-09-11  
**Reviewer:** Claude Haiku 4.5  
**Overall Score:** 7.5/10

### Strengths ✅
- Clean entity tables (no denormalization)
- Proper composite keys for multi-tenancy
- Foreign keys with CASCADE delete
- CHECK constraints on enums
- Strategic index on common query

### Areas for Improvement ⚠️
- Add FK on `deployments.bundleId`
- Add index on `deployments.bundle_id`
- Extract platform/runtime_version to dimension tables (future optimization)

See `/scratchpad/d1-schema-review.md` for detailed audit.

---

## References

- **Schema Definition:** `worker/db/schema.ts`
- **Migrations:** `migrations/`
- **API Implementation:** `worker/control-api.ts` (writes)
- **Public Routes:** `worker/index.ts` (reads)
- **Console Component:** `src/features/delivery/DeliveryConsoleDashboard.tsx`
- **Drizzle Docs:** https://orm.drizzle.team/docs/sql-json-1
- **SQLite Docs:** https://www.sqlite.org/lang.html
- **D1 Docs:** https://developers.cloudflare.com/d1/

