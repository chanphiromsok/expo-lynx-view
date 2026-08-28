# Roadmap

Deferred work only. Current architecture is in [ARCHITECTURE.md](./ARCHITECTURE.md).

| Item | Add only when |
|---|---|
| Multi-feature mini-app registry | A second Lynx feature must ship independently |
| Sparkling embed layer | Multi-feature scheme routing is actually required |
| bsdiff | Real bundles exceed 2 MB and measured deltas save at least 3× |
| Rollout cohorts | Production needs phased percentage rollout |
| Runtime channel switching | Testers need in-app stable/beta selection |
| Automated native fingerprint | Manual `runtimeVersion` causes a real targeting mistake |

R2 and D1 already replicate globally; do not add custom multi-region infrastructure.

When a trigger occurs, create one new spec under `specs/`. Until then, keep it out of production code.
