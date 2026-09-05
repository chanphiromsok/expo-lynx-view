# D01 — Cross-team integration documentation

**Status:** approved specification; implement with I01.

**Depends on:** [I01 — Host-owned runtime](i01-independent-miniapp-workspaces.md)
and [I02 — Console setup, upload, and doctor](i02-console-setup-upload-doctor.md).

## Goal

Make `apps/docs` the canonical guide for setting up one shared Cloudflare
Console, integrating an Expo host application, releasing one independent Lynx
mini app, and safely changing the host native runtime.

A new reader must be able to identify which repository they are working in,
which command they should run, which credentials they need, and what happens
when registration or delivery is unavailable.

## Reader paths

The documentation starts with three roles instead of one monorepo workflow:

```text
Console operator
  -> provision one Worker/D1/R2
  -> create host app
  -> create mini-app IDs

Host-app team
  -> install expo-lynx-view
  -> configure embedded bundles, public key, and endpoints
  -> prepare locally
  -> build native app
  -> explicitly register the prepared runtime

Mini-app team
  -> configure appId + feature
  -> build and upload from an independent repository
  -> verify the displayed target host build
  -> ask an operator to test and enable it
```

Do not begin with database tables, signatures, D1, R2, or fingerprint internals.
Introduce those only where the reader needs them.

## Information architecture

Reuse the existing Starlight application and most existing pages. Add only two
new workflow pages:

```text
Start here
  Overview
  Installation                     update: host module only
  Local development                update: embedded/local behavior

Managed delivery
  Cloudflare Console setup         rewrite existing cloudflare-worker.mdx
  Host app integration             new host-app-integration.mdx
  Mini-app integration             new mini-app-integration.mdx
  Embedded and remote lifecycle    update existing lifecycle.mdx
  Local testing                    reuse existing local pages

Reference
  CLI                               rewrite existing cli.mdx
  Troubleshooting                  extend existing local-delivery.mdx
```

Do not create separate pages for fingerprint theory, D1 schema, R2 internals,
manual release, CI release, or every error code. Short sections in the pages
above are sufficient.

## Required page content

### Console setup

Update `managed-delivery/cloudflare-worker.mdx` to explain:

- one Console/Worker serves multiple host apps and mini apps;
- Cloudflare provisioning is run once by the operator, not in each app repo;
- the operator creates `BS One / merchant-home` before either team uploads;
- typo IDs are rejected rather than auto-created;
- which generated values are shared with host CI versus mini-app CI;
- how to deploy later Worker changes without recreating D1/R2 or users.
- how packaged `console setup` runs outside this monorepo, resumes partial
  provisioning, and generates the signing pair without writing the private key;
- how `lynx doctor` and `lynx doctor --remote` validate the result without
  changing Cloudflare state.

Show the Console hierarchy before showing credentials:

```text
Apps -> BS One -> Merchant Home -> Current host build -> Bundles
```

### Host app integration

Create `managed-delivery/host-app-integration.mdx` with one complete host
example:

```json
[
  "expo-lynx-view",
  {
    "embeddedBundlesPath": "./generated/expo-lynx/embedded",
    "publicKeyPath": "./keys/lynx/updates.public.pem",
    "deliveryEndpoints": {
      "merchant-home": "https://delivery.example.com/v1/bs-one/merchant-home"
    }
  }
]
```

Explain that the host owns native compatibility and embedded fallback, but not
mini-app source. Document these exact flows:

```bash
# local only; no Worker credential or network mutation
pnpm lynx host prepare

# manual production release
pnpm lynx host prepare
# build and verify the native archive
pnpm lynx host register

# CI one-shot
pnpm lynx host prepare --register
```

State that registration reads the prepared runtime, that changing the project
after preparation makes registration fail, and that an unregistered runtime
uses embedded content rather than another runtime's remote bundle.

### Mini-app integration

Create `managed-delivery/mini-app-integration.mdx` for a repository with no Expo
host checkout:

```ts
import { defineMiniApp } from 'expo-lynx-bundle-cli';

export default defineMiniApp({
  appId: 'bs-one',
  feature: 'merchant-home'
});
```

Document the conventional `src/index.tsx` and `lynx.config.ts` paths and the
single release command:

```bash
pnpm lynx release
```

The guide must state that the mini-app repository has no Expo fingerprint,
runtime flag, private deployment-signing key, host source path, or feature map.
The upload result shows a human-readable target such as `BS One 1.2.0 (build
42)`. Interactive upload confirms that label; non-interactive CI supplies the
expected build label and fails when it differs.

Link to the I02 upload-v2 contract from reference material, but keep the normal
guide focused on `pnpm lynx release`, target verification, and Console
promotion rather than raw HTTP.

### Lifecycle and failure behavior

Update the lifecycle page with one old/new native-build example:

```text
Host v1 asks for runtime A -> only A deployment
Host v2 asks for runtime B -> only B deployment
No B registration/selection -> signed disabled B -> embedded B bundle
```

Clarify these independent controls:

- `enabled: false` stops new distribution but does not remove installed cache;
- `force: false` stages a verified bundle for the next feature open;
- `force: true` reloads a mounted view only after verified installation;
- upload never selects or enables a bundle;
- registration never selects or enables a bundle.

### CLI reference

Replace the old host-owned `bundle <feature>` workflow with one table:

| Command | Repository | Network effect |
| --- | --- | --- |
| `lynx host prepare` | Expo host | None |
| `lynx host register` | Expo host | Sets the prepared current host runtime |
| `lynx host prepare --register` | Expo host/CI | Prepares, then registers |
| `lynx release` | Mini app | Uploads and registers a runtime-pinned candidate |
| `lynx release --draft` | Mini app | None |
| `lynx release upload <dir>` | Mini app | Registers or resumes an existing release |
| `lynx doctor` | Any workspace | Local read-only configuration checks |
| `lynx doctor --remote` | Any workspace | Local plus remote read-only checks |

For every command, list prerequisites, files read/written, required environment
variables, success output, and the most common actionable failure. Never print
or use example values that resemble real credentials.

### Troubleshooting

Add short decision paths for:

- `Host app has no registered current build`;
- displayed upload target is an older app version/build;
- project changed after `host prepare`;
- device uses embedded content after a native upgrade;
- app/feature is unknown because of a typo or missing Console registration;
- Worker authentication, direct R2 `403`, signature, replay, and runtime
  mismatch failures.

Each entry says which team owns the fix. Do not tell a mini-app developer to
copy a fingerprint from the host repository.

## Credential matrix

Include this single matrix and reuse links to it instead of duplicating secrets
through every page:

| Credential | Console operator | Host CI | Mini-app CI | Mobile |
| --- | --- | --- | --- | --- |
| Worker deployment private key | owns | no | no | no |
| Worker API key | creates | runtime registration | upload registration | no |
| R2 S3 object-write key | creates | no | upload only | no |
| Deployment public key | distributes | embeds | no | verifies |

Document environment-variable names, where each ignored environment file
lives, and least required access. Never include a real token, password, account
ID, bucket secret, or PEM body.

## Writing requirements

- Use copyable commands from the correct repository root.
- Label planned commands as unavailable until I01 implementation lands; remove
  that warning in the same change that implements them.
- Use `BS One / merchant-home` consistently as the cross-team example.
- Call the human-facing value **Current host build**, not fingerprint.
- Define `runtimeVersion` once in the lifecycle page as an internal opaque
  compatibility identity.
- Keep package READMEs as short installation/API summaries linking here.
- Remove or redirect old examples that put mini-app source and a feature map in
  the Expo host repository.
- Do not document Android delivery as implemented until it is verified.

## Verification

```bash
pnpm docs:build
rg -n "featuresDir|features:|runtimeVersion.*config|fingerprintPath" apps/docs/src/content/docs
git diff --check
```

The search may find historical explanations, but no copyable mini-app or host
configuration may contain those removed fields. Documentation verification must
not run Expo prebuild, CocoaPods, Xcode, a simulator, Gradle, or a native build.

## Acceptance criteria

- [ ] A Console operator can provision once and create one host app plus one
      mini app without reading package source.
- [ ] A host developer can distinguish local preparation, explicit manual
      registration, and one-shot CI registration.
- [ ] A mini-app developer can release from a separate repository without the
      host checkout or a fingerprint value.
- [ ] Every command identifies its repository and credential requirements.
- [ ] The runtime A/B example explains why a missing registration safely uses
      embedded content.
- [ ] The credential matrix makes clear that no private Worker/R2 credential is
      shipped to mobile.
- [ ] Existing outdated monorepo-only workflow examples are removed or marked
      as legacy.
- [ ] Starlight navigation exposes the host and mini-app integration pages and
      `pnpm docs:build` succeeds.
