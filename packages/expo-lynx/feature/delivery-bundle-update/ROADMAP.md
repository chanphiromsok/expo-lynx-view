# Roadmap

Deferred work only. Current architecture is in [ARCHITECTURE.md](./ARCHITECTURE.md).

| Item | Add only when |
|---|---|
| Sparkling embed layer | Multi-feature scheme routing is actually required |
| bsdiff | Real bundles exceed 2 MB and measured deltas save at least 3× |
| Rollout cohorts | Production needs phased percentage rollout |
| Runtime channel switching | Testers need in-app stable/beta selection |
| Automated native fingerprint | Manual `runtimeVersion` causes a real targeting mistake |
| SQLite device catalog | Measured release count/query needs exceed completion files and the small native state store |
| Terminated-app background download | Foreground/open-time prefetch misses a measured product requirement |
| iOS Lynx engine reuse | Lynx exposes a supported API and profiling shows repeated engine creation is material |
| Mid-session forced replacement | Product requirements justify the UX/memory risk and a new signed protocol mode is reviewed |
| Multiple/per-feature trust roots or split signing roles | Different publishers or measured compromise blast radius justify a key registry, rotation overlap, and migration protocol |

R2 and D1 already replicate globally; do not add custom multi-region infrastructure.

When a trigger occurs, add one dependency-scoped spec under `specs/v2`. Until
then, keep it out of production code.
